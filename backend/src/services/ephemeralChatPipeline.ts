/**
 * Same anti-hallucination pipeline as `chatPipeline.ts`, but retrieval runs
 * in-memory against the session's pre-embedded chunks. Now matches the
 * persistent path's upgrades: parent-document retrieval, table-aware boost,
 * and a streaming variant.
 */

import logger from "../logger.js";
import { embedBatch, geminiJSON, geminiText, geminiTextStream } from "./gemini.js";
import type { ChatTurn, ChatAnswer, ChatStreamEvent } from "./chatPipeline.js";
import type { EphemeralChunk } from "./ephemeralChatStore.js";
import { isTableLikelyQuery } from "./chunking.js";
import { smallTalkReply } from "./chatSmallTalk.js";

const REFUSAL_PHRASE = "I couldn't find this in the file.";

const REWRITE_SCHEMA = {
    type: "OBJECT",
    properties: { standalone_query: { type: "STRING" } },
    required: ["standalone_query"],
};

const VARIATIONS_SCHEMA = {
    type: "OBJECT",
    properties: {
        variations: { type: "ARRAY", items: { type: "STRING" } },
        hyde: { type: "STRING" },
    },
    required: ["variations", "hyde"],
};

const RERANK_SCHEMA = {
    type: "OBJECT",
    properties: {
        scores: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { chunk_index: { type: "INTEGER" }, score: { type: "INTEGER" } },
                required: ["chunk_index", "score"],
            },
        },
    },
    required: ["scores"],
};

const rewriteQuery = async (history: ChatTurn[], question: string): Promise<string> => {
    if (history.length === 0) return question;
    const transcript = history
        .slice(-6)
        .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
        .join("\n");
    try {
        const out = await geminiJSON<{ standalone_query: string }>(
            `Rewrite the latest user question into a standalone search query that doesn't rely on prior conversation context.
Resolve pronouns and references. Do NOT answer.

Conversation:
${transcript}

Latest question: ${question}`,
            REWRITE_SCHEMA, 256, "ephemeral:rewrite",
        );
        return out?.standalone_query?.trim() || question;
    } catch (e) {
        logger.warn(`ephemeral rewriteQuery failed: ${e}`);
        return question;
    }
};

const expandQueries = async (q: string): Promise<{ all: string[]; hyde: string }> => {
    try {
        const out = await geminiJSON<{ variations: string[]; hyde: string }>(
            `Given a search query, output:
1) Two ALTERNATE phrasings of the same intent.
2) A short (2-3 sentence) HYPOTHETICAL ANSWER (HyDE) that would directly answer the query.

Query: "${q}"`,
            VARIATIONS_SCHEMA, 512, "ephemeral:multi-query",
        );
        const variations = (out?.variations ?? []).filter((v): v is string => typeof v === "string" && v.trim()).slice(0, 2);
        return { all: [q, ...variations].filter(Boolean), hyde: (out?.hyde ?? "").trim() };
    } catch (e) {
        logger.warn(`ephemeral expandQueries failed: ${e}`);
        return { all: [q], hyde: "" };
    }
};

const cosine = (a: number[], b: number[]): number => {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
};

type ScoredChunk = {
    chunk_index: number;
    chunk_text: string;
    parent_text?: string;
    has_table?: boolean;
    score: number;
    rerank_score?: number;
};

const retrieveFromMemory = async (
    chunks: EphemeralChunk[],
    queries: string[],
    hyde: string,
    perQueryLimit = 20,
): Promise<ScoredChunk[]> => {
    const queryTexts = [...queries, ...(hyde ? [hyde] : [])];
    const queryVectors = await embedBatch(queryTexts);
    const byIndex = new Map<number, ScoredChunk>();
    for (const qv of queryVectors) {
        if (!qv) continue;
        const scored = chunks
            .map((c) => ({
                chunk_index: c.index,
                chunk_text: c.text,
                parent_text: c.parent_text,
                has_table: c.has_table,
                score: cosine(qv, c.vector),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, perQueryLimit);
        for (const s of scored) {
            const existing = byIndex.get(s.chunk_index);
            if (!existing || s.score > existing.score) byIndex.set(s.chunk_index, s);
        }
    }
    return Array.from(byIndex.values()).sort((a, b) => b.score - a.score);
};

const rerank = async (query: string, candidates: ScoredChunk[], keep = 5): Promise<ScoredChunk[]> => {
    if (candidates.length <= keep) return candidates.map((c) => ({ ...c, rerank_score: c.score * 10 }));
    const pool = candidates.slice(0, 20);
    const formatted = pool.map((c) => `[Chunk index=${c.chunk_index}]\n${c.chunk_text.slice(0, 800)}`).join("\n\n---\n\n");
    try {
        const out = await geminiJSON<{ scores: { chunk_index: number; score: number }[] }>(
            `Score each chunk's relevance to the query on a 0-10 scale.
- 10 directly answers. 7-9 highly relevant. 4-6 tangential. 0-3 not relevant.

Query: "${query}"

Chunks:
${formatted}

Reference each by its chunk_index.`,
            RERANK_SCHEMA, 1024, "ephemeral:rerank",
        );
        const scoreByIdx = new Map<number, number>();
        for (const s of out?.scores ?? []) {
            if (typeof s.chunk_index === "number" && typeof s.score === "number") {
                scoreByIdx.set(s.chunk_index, s.score);
            }
        }
        return pool
            .map((c) => ({ ...c, rerank_score: scoreByIdx.get(c.chunk_index) ?? -1 }))
            .filter((c) => c.rerank_score! >= 0)
            .sort((a, b) => b.rerank_score! - a.rerank_score!)
            .slice(0, keep);
    } catch (e) {
        logger.warn(`ephemeral rerank failed (using bi-encoder order): ${e}`);
        return pool.slice(0, keep).map((c) => ({ ...c, rerank_score: c.score * 10 }));
    }
};

const buildAnswerPrompt = (
    filename: string,
    chunks: ScoredChunk[],
    history: ChatTurn[],
    question: string,
): string => {
    // Parent-document retrieval — send the larger parent text to the LLM,
    // dedupe by parent so we don't repeat a section.
    const seenParents = new Set<string>();
    const blocks: string[] = [];
    let n = 1;
    for (const c of chunks) {
        const body = (c.parent_text && c.parent_text.length > c.chunk_text.length) ? c.parent_text : c.chunk_text;
        if (seenParents.has(body)) continue;
        seenParents.add(body);
        blocks.push(`[Chunk ${n}]${c.has_table ? " (contains a table)" : ""}\n${body}`);
        n++;
    }
    const ctx = blocks.join("\n\n---\n\n");
    const transcript = history.length === 0
        ? ""
        : history.slice(-4).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n");
    return `You are answering a question about a file the user uploaded for a one-off chat.

STRICT RULES:
1. Use ONLY the chunks below. No outside knowledge.
2. Every factual claim must be followed by [Chunk N].
3. If multiple chunks support a claim, cite all of them.
4. If the answer is NOT in the chunks, output EXACTLY this and nothing else:
${REFUSAL_PHRASE}
5. Be concise; markdown lists when useful.
6. Never invent chunk numbers.

File: "${filename}"

--- Chunks ---
${ctx}
--- End chunks ---

${transcript ? `Prior conversation:\n${transcript}\n\n` : ""}Question: ${question}

Answer (with citations):`;
};

const parseCitations = (s: string): Set<number> => {
    const out = new Set<number>();
    for (const m of s.matchAll(/\[Chunk\s*(\d+)\]/gi)) out.add(parseInt(m[1], 10));
    return out;
};

const stripInvalidCitations = (s: string, valid: Set<number>): { text: string; removed: number } => {
    let removed = 0;
    const cleaned = s.replace(/\[Chunk\s*(\d+)\]/gi, (_, n) => {
        const num = parseInt(n, 10);
        if (valid.has(num)) return `[Chunk ${num}]`;
        removed++;
        return "";
    });
    return { text: cleaned.replace(/\s+([.,;:!?])/g, "$1").replace(/  +/g, " ").trim(), removed };
};

const confidenceFor = (chunks: ScoredChunk[], cited: Set<number>, outOfScope: boolean): ChatAnswer["confidence"] => {
    if (outOfScope || chunks.length === 0) return "none";
    const topRerank = Math.max(...chunks.map((c) => c.rerank_score ?? c.score * 10));
    if (topRerank >= 8 && cited.size > 0) return "high";
    if (topRerank >= 6 && cited.size > 0) return "medium";
    return "low";
};

const tableBoost = (cands: ScoredChunk[], query: string): ScoredChunk[] => {
    if (!isTableLikelyQuery(query)) return cands;
    for (const c of cands) if (c.has_table) c.score = Math.min(1, c.score * 1.15 + 0.05);
    return cands.sort((a, b) => b.score - a.score);
};

export type EphemeralChatParams = {
    filename: string;
    chunks: EphemeralChunk[];
    history: ChatTurn[];
    message: string;
};

export const runEphemeralChat = async (params: EphemeralChatParams): Promise<ChatAnswer> => {
    const { filename, chunks, history, message } = params;

    const small = smallTalkReply(message);
    if (small) return small;

    const standalone = await rewriteQuery(history, message);
    const { all, hyde } = await expandQueries(standalone);
    const candidates = tableBoost(await retrieveFromMemory(chunks, all, hyde, 20), standalone);

    if (candidates.length === 0) {
        return {
            answer: REFUSAL_PHRASE, sources: [], confidence: "none", refused: true, out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
    }

    const reranked = await rerank(standalone, candidates, 5);
    const RERANK_FLOOR = 4;
    const passing = reranked.filter((c) => (c.rerank_score ?? 0) >= RERANK_FLOOR);
    if (passing.length === 0) {
        return {
            answer: REFUSAL_PHRASE, sources: reranked.slice(0, 3), confidence: "none", refused: true, out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
    }

    const prompt = buildAnswerPrompt(filename, passing, history, standalone);
    let answer = (await geminiText(prompt, 1024)).trim();
    const outOfScope = answer.toLowerCase().includes(REFUSAL_PHRASE.toLowerCase());

    if (!outOfScope) {
        const valid = new Set<number>(passing.map((_, i) => i + 1));
        const cited = parseCitations(answer);
        const stripped = stripInvalidCitations(answer, valid);
        if (stripped.removed > 0) logger.warn(`ephemeral chat: stripped ${stripped.removed} invalid citations`);
        answer = stripped.text;
        const validCited = new Set([...cited].filter((n) => valid.has(n)));
        if (validCited.size === 0) {
            return {
                answer: REFUSAL_PHRASE, sources: passing, confidence: "none", refused: true, out_of_scope: true,
                rewritten_query: standalone !== message ? standalone : undefined,
            };
        }
    }

    return {
        answer,
        sources: passing,
        confidence: confidenceFor(passing, parseCitations(answer), outOfScope),
        refused: outOfScope,
        out_of_scope: outOfScope,
        rewritten_query: standalone !== message ? standalone : undefined,
    };
};

export const runEphemeralChatStream = async function* (
    params: EphemeralChatParams,
): AsyncGenerator<ChatStreamEvent, void, void> {
    const { filename, chunks, history, message } = params;

    const small = smallTalkReply(message);
    if (small) {
        yield { type: "delta", text: small.answer };
        yield {
            type: "done", answer: small.answer, sources: [],
            confidence: "high", refused: false, out_of_scope: false,
        };
        return;
    }

    const standalone = await rewriteQuery(history, message);
    yield { type: "prep", rewritten_query: standalone !== message ? standalone : undefined };

    const { all, hyde } = await expandQueries(standalone);
    const candidates = tableBoost(await retrieveFromMemory(chunks, all, hyde, 20), standalone);
    if (candidates.length === 0) {
        yield { type: "no_sources" };
        yield {
            type: "done", answer: REFUSAL_PHRASE, sources: [], confidence: "none",
            refused: true, out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
        return;
    }

    const reranked = await rerank(standalone, candidates, 5);
    const RERANK_FLOOR = 4;
    const passing = reranked.filter((c) => (c.rerank_score ?? 0) >= RERANK_FLOOR);
    if (passing.length === 0) {
        yield { type: "no_sources" };
        yield {
            type: "done", answer: REFUSAL_PHRASE, sources: reranked.slice(0, 3),
            confidence: "none", refused: true, out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
        return;
    }

    const prompt = buildAnswerPrompt(filename, passing, history, standalone);
    let buffer = "";
    try {
        for await (const delta of geminiTextStream(prompt, 1024)) {
            buffer += delta;
            yield { type: "delta", text: delta };
        }
    } catch (e) {
        logger.error(`ephemeral stream failed: ${e}`);
        yield { type: "error", message: "Streaming failed mid-response." };
        return;
    }

    let answer = buffer.trim();
    const outOfScope = answer.toLowerCase().includes(REFUSAL_PHRASE.toLowerCase());
    if (!outOfScope) {
        const valid = new Set<number>(passing.map((_, i) => i + 1));
        const cited = parseCitations(answer);
        const stripped = stripInvalidCitations(answer, valid);
        if (stripped.removed > 0) logger.warn(`ephemeral stream: stripped ${stripped.removed} invalid citations`);
        answer = stripped.text;
        const validCited = new Set([...cited].filter((n) => valid.has(n)));
        if (validCited.size === 0) {
            yield {
                type: "done", answer: REFUSAL_PHRASE, sources: passing,
                confidence: "none", refused: true, out_of_scope: true,
                rewritten_query: standalone !== message ? standalone : undefined,
            };
            return;
        }
    }

    yield {
        type: "done",
        answer,
        sources: passing,
        confidence: confidenceFor(passing, parseCitations(answer), outOfScope),
        refused: outOfScope,
        out_of_scope: outOfScope,
        rewritten_query: standalone !== message ? standalone : undefined,
    };
};
