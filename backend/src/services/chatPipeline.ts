/**
 * Production-grade RAG chat pipeline.
 *
 * Order of operations (every step is here for a specific class of failure):
 *  1. Query rewrite  → fix follow-up ambiguity ("what about Q4?")
 *  2. Multi-query + HyDE → improve recall on hard questions
 *  3. Over-retrieve   → bi-encoders are recall-optimised, give the reranker room
 *  4. LLM rerank      → bi-encoder is fuzzy; the reranker is precise
 *  5. Confidence gate → if nothing crosses a threshold, refuse without LLM call
 *  6. Strict prompt   → require [Chunk N] citations, refuse with a fixed phrase
 *  7. Citation check  → drop / refuse if model cites chunks we didn't send
 */

import { Filters } from "weaviate-client";
import logger from "../logger.js";
import getWeaviateClient from "../db/weaviate_client.js";
import { embedBatch, geminiJSON, geminiText, geminiTextStream } from "./gemini.js";
import { isTableLikelyQuery } from "./chunking.js";
import { smallTalkReply } from "./chatSmallTalk.js";

const CHUNK_COLLECTIONS = [
    "SmartDriveDocumentChunks",
    "SmartDriveImageChunks",
    "SmartDriveMediaChunks",
];

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatSource = {
    chunk_index: number;
    chunk_text: string;
    /** Parent-document text — sent to the LLM instead of the small child chunk
     *  so the model has real context. Falls back to chunk_text on legacy rows. */
    parent_text?: string;
    has_table?: boolean;
    score: number;
    rerank_score?: number;
};

export type ChatAnswer = {
    answer: string;
    sources: ChatSource[];
    confidence: "high" | "medium" | "low" | "none";
    refused: boolean;
    rewritten_query?: string;
    /** True if the model returned the canonical "couldn't find this" phrase. */
    out_of_scope: boolean;
};

const REFUSAL_PHRASE = "I couldn't find this in the file.";

// ---------- 1. Conversational query rewriting ----------

const REWRITE_SCHEMA = {
    type: "OBJECT",
    properties: {
        standalone_query: {
            type: "STRING",
            description: "A self-contained version of the latest user question that doesn't depend on conversation context. If the question is already standalone, return it unchanged.",
        },
    },
    required: ["standalone_query"],
};

const rewriteQuery = async (history: ChatTurn[], question: string): Promise<string> => {
    if (history.length === 0) return question; // first turn — nothing to resolve
    const transcript = history
        .slice(-6)
        .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
        .join("\n");
    try {
        const out = await geminiJSON<{ standalone_query: string }>(
            `Rewrite the latest user question into a standalone search query that doesn't rely on prior conversation context.
Resolve pronouns ("it", "that"), implicit references ("what about Q4?" → "Q4 of [topic from history]"), and abbreviations.
If the question is already standalone, return it unchanged. Do NOT answer the question.

Conversation:
${transcript}

Latest question: ${question}`,
            REWRITE_SCHEMA,
            256,
            "chat:rewrite",
        );
        const sq = out?.standalone_query?.trim();
        return sq && sq.length > 0 ? sq : question;
    } catch (e) {
        logger.warn(`rewriteQuery failed (using original): ${e}`);
        return question;
    }
};

// ---------- 2. Multi-query + HyDE ----------

const VARIATIONS_SCHEMA = {
    type: "OBJECT",
    properties: {
        variations: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Two alternate phrasings of the same intent.",
        },
        hyde: {
            type: "STRING",
            description: "A hypothetical 2-3 sentence answer that would directly answer the query. Used to improve embedding-based retrieval — not shown to the user.",
        },
    },
    required: ["variations", "hyde"],
};

const expandQueries = async (query: string): Promise<{ all: string[]; hyde: string }> => {
    try {
        const out = await geminiJSON<{ variations: string[]; hyde: string }>(
            `Given a search query, output:
1) Two ALTERNATE phrasings someone might use for the SAME intent.
2) A short (2-3 sentence) HYPOTHETICAL ANSWER that would directly answer the query. This is used as an embedding for retrieval.

Query: "${query}"`,
            VARIATIONS_SCHEMA,
            512,
            "chat:multi-query",
        );
        const variations = (out?.variations ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, 2);
        const hyde = (out?.hyde ?? "").trim();
        const all = [query, ...variations].filter(Boolean);
        return { all, hyde };
    } catch (e) {
        logger.warn(`expandQueries failed (using original only): ${e}`);
        return { all: [query], hyde: "" };
    }
};

// ---------- 3. Over-retrieve ----------

type RetrievedChunk = ChatSource;

const retrieveChunks = async (
    userId: string,
    fileId: string,
    queries: string[],
    hyde: string,
    perQueryLimit = 20,
): Promise<RetrievedChunk[]> => {
    const client = await getWeaviateClient();
    if (!client) return [];

    // Batch embed all queries + the HyDE answer in a single API call.
    const allTexts = [...queries, ...(hyde ? [hyde] : [])];
    const vectors = await embedBatch(allTexts);

    const byChunkIndex = new Map<number, RetrievedChunk>();

    for (let q = 0; q < allTexts.length; q++) {
        const queryText = allTexts[q];
        const queryVector = vectors[q];
        if (!queryVector) continue;
        for (const colName of CHUNK_COLLECTIONS) {
            if (!(await client.collections.exists(colName))) continue;
            const col = client.collections.get(colName);
            try {
                const res = await col.query.hybrid(queryText, {
                    vector: queryVector,
                    alpha: 0.5,
                    limit: perQueryLimit,
                    filters: Filters.and(
                        col.filter.byProperty("user_id").equal(userId),
                        col.filter.byProperty("file_id").equal(fileId),
                    ),
                    returnMetadata: ["score"],
                });
                for (const obj of res.objects) {
                    const props = obj.properties as {
                        chunk_index?: number; chunk_text?: string;
                        parent_text?: string; has_table?: boolean;
                    };
                    const idx = Number(props.chunk_index ?? -1);
                    const text = String(props.chunk_text ?? "");
                    if (idx < 0 || !text) continue;
                    const score = obj.metadata?.score ?? 0;
                    const existing = byChunkIndex.get(idx);
                    if (!existing || score > existing.score) {
                        byChunkIndex.set(idx, {
                            chunk_index: idx,
                            chunk_text: text,
                            parent_text: props.parent_text || undefined,
                            has_table: Boolean(props.has_table),
                            score,
                        });
                    }
                }
            } catch (e) {
                logger.warn(`retrieveChunks ${colName} failed: ${e}`);
            }
        }
    }

    return Array.from(byChunkIndex.values()).sort((a, b) => b.score - a.score);
};

// ---------- 4. LLM reranker ----------

const RERANK_SCHEMA = {
    type: "OBJECT",
    properties: {
        scores: {
            type: "ARRAY",
            description: "Per-chunk relevance scores in the SAME ORDER as the input chunks.",
            items: {
                type: "OBJECT",
                properties: {
                    chunk_index: { type: "INTEGER" },
                    score: {
                        type: "INTEGER",
                        description: "0-10. 10 = directly answers the query. 7-9 = highly relevant. 4-6 = tangential. 0-3 = not relevant.",
                    },
                },
                required: ["chunk_index", "score"],
            },
        },
    },
    required: ["scores"],
};

const rerank = async (query: string, candidates: RetrievedChunk[], keep = 5): Promise<RetrievedChunk[]> => {
    if (candidates.length <= keep) {
        // Still mark rerank_score = score so downstream code has it.
        return candidates.map((c) => ({ ...c, rerank_score: c.score * 10 }));
    }
    // Trim to a manageable rerank pool to keep the prompt small.
    const pool = candidates.slice(0, 20);
    const formatted = pool
        .map((c) => `[Chunk index=${c.chunk_index}]\n${c.chunk_text.slice(0, 800)}`)
        .join("\n\n---\n\n");
    try {
        const out = await geminiJSON<{ scores: { chunk_index: number; score: number }[] }>(
            `Score each chunk's relevance to the query on a 0-10 scale (integers only).
- 10 directly answers the query.
- 7-9 contains highly relevant info.
- 4-6 tangentially related.
- 0-3 not relevant.

Query: "${query}"

Chunks:
${formatted}

Output the scores array in the same order, referencing chunks by their chunk_index.`,
            RERANK_SCHEMA,
            1024,
            "chat:rerank",
        );
        const scoreByIdx = new Map<number, number>();
        for (const s of out?.scores ?? []) {
            if (typeof s.chunk_index === "number" && typeof s.score === "number") {
                scoreByIdx.set(s.chunk_index, s.score);
            }
        }
        const reranked = pool
            .map((c) => ({ ...c, rerank_score: scoreByIdx.get(c.chunk_index) ?? -1 }))
            // Drop chunks we couldn't score at all rather than risk a bad ranking.
            .filter((c) => c.rerank_score >= 0)
            .sort((a, b) => b.rerank_score! - a.rerank_score!);
        return reranked.slice(0, keep);
    } catch (e) {
        logger.warn(`rerank failed, falling back to bi-encoder order: ${e}`);
        return pool.slice(0, keep).map((c) => ({ ...c, rerank_score: c.score * 10 }));
    }
};

// ---------- 5/6/7. Confidence gate, strict prompt, citation validation ----------

const buildAnswerPrompt = (
    filename: string,
    chunks: RetrievedChunk[],
    history: ChatTurn[],
    question: string,
): string => {
    // Parent-document retrieval: send the bigger parent text to the LLM so it
    // gets real context, not 5 disconnected sentences. Falls back to chunk_text
    // for legacy rows that don't have parent_text yet.
    // Dedupe by parent_text so we don't send the same section twice.
    const seenParents = new Set<string>();
    const ctxBlocks: string[] = [];
    let n = 1;
    for (const c of chunks) {
        const body = (c.parent_text && c.parent_text.length > c.chunk_text.length) ? c.parent_text : c.chunk_text;
        if (seenParents.has(body)) continue;
        seenParents.add(body);
        ctxBlocks.push(`[Chunk ${n}]${c.has_table ? " (contains a table)" : ""}\n${body}`);
        n++;
    }
    const ctx = ctxBlocks.join("\n\n---\n\n");
    const transcript = history.length === 0
        ? ""
        : history.slice(-4).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n");
    return `You are answering a question about a single file the user uploaded.

STRICT RULES:
1. Use ONLY the chunks provided below. Do not draw on outside knowledge.
2. Every factual claim must be followed by a citation in square brackets, e.g. [Chunk 3].
3. If multiple chunks support a claim, cite them all: [Chunk 1][Chunk 3].
4. If the answer is NOT present in the chunks, output EXACTLY this and nothing else:
${REFUSAL_PHRASE}
5. Be concise. Use markdown lists when it helps clarity.
6. Never make up chunk numbers — only cite chunks shown below.

File: "${filename}"

--- Chunks ---
${ctx}
--- End chunks ---

${transcript ? `Prior conversation:\n${transcript}\n\n` : ""}Question: ${question}

Answer (with citations):`;
};

const parseCitations = (answer: string): Set<number> => {
    const out = new Set<number>();
    for (const m of answer.matchAll(/\[Chunk\s*(\d+)\]/gi)) {
        out.add(parseInt(m[1], 10));
    }
    return out;
};

const stripInvalidCitations = (answer: string, validNums: Set<number>): { answer: string; removed: number } => {
    let removed = 0;
    const cleaned = answer.replace(/\[Chunk\s*(\d+)\]/gi, (full, num) => {
        const n = parseInt(num, 10);
        if (validNums.has(n)) return `[Chunk ${n}]`;
        removed++;
        return ""; // drop the bogus citation but keep the surrounding sentence
    });
    return { answer: cleaned.replace(/\s+([.,;:!?])/g, "$1").replace(/  +/g, " ").trim(), removed };
};

const computeConfidence = (
    chunks: RetrievedChunk[],
    citedNums: Set<number>,
    out_of_scope: boolean,
): "high" | "medium" | "low" | "none" => {
    if (out_of_scope) return "none";
    if (chunks.length === 0) return "none";
    const topRerank = Math.max(...chunks.map((c) => c.rerank_score ?? c.score * 10));
    const citationCoverage = citedNums.size / chunks.length;
    if (topRerank >= 8 && citedNums.size > 0) return "high";
    if (topRerank >= 6 && citedNums.size > 0) return "medium";
    if (citationCoverage > 0 || topRerank >= 5) return "low";
    return "low";
};

// ---------- Public entry point ----------

export type ChatPipelineParams = {
    userId: string;
    fileId: string;
    filename: string;
    history: ChatTurn[];
    message: string;
};

export const runChatPipeline = async (params: ChatPipelineParams): Promise<ChatAnswer> => {
    const { userId, fileId, filename, history, message } = params;

    // 0. Pleasantry fast-path. "Thanks" / "ok" / "hi" shouldn't trigger retrieval.
    const small = smallTalkReply(message);
    if (small) return small;

    // 1. Rewrite the question to be standalone.
    const standalone = await rewriteQuery(history, message);
    if (standalone !== message) {
        logger.info(`chat: rewrote "${message}" → "${standalone}"`);
    }

    // 2. Generate variations + HyDE.
    const { all, hyde } = await expandQueries(standalone);

    // 3. Over-retrieve.
    const candidates = await retrieveChunks(userId, fileId, all, hyde, 20);

    // Table-aware boost: if the question looks tabular ("total", "how many",
    // "list of"), nudge table-bearing chunks up so they survive rerank.
    if (isTableLikelyQuery(standalone)) {
        for (const c of candidates) {
            if (c.has_table) c.score = Math.min(1, c.score * 1.15 + 0.05);
        }
        candidates.sort((a, b) => b.score - a.score);
    }

    // 5a. No-context refusal — if nothing came back, refuse before calling the LLM.
    if (candidates.length === 0) {
        return {
            answer: REFUSAL_PHRASE,
            sources: [],
            confidence: "none",
            refused: true,
            out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
    }

    // 4. Rerank down to top 5.
    const reranked = await rerank(standalone, candidates, 5);

    // 5b. Drop anything below the rerank floor; if nothing crosses the bar, refuse.
    const RERANK_FLOOR = 4;
    const passing = reranked.filter((c) => (c.rerank_score ?? 0) >= RERANK_FLOOR);
    if (passing.length === 0) {
        logger.info(`chat: no chunks crossed rerank floor ${RERANK_FLOOR} (top=${reranked[0]?.rerank_score})`);
        return {
            answer: REFUSAL_PHRASE,
            sources: reranked.slice(0, 3), // expose top chunks anyway so user can sanity-check
            confidence: "none",
            refused: true,
            out_of_scope: true,
            rewritten_query: standalone !== message ? standalone : undefined,
        };
    }

    // 6. Build the strict prompt and ask the model.
    const prompt = buildAnswerPrompt(filename, passing, history, standalone);
    let answer = await geminiText(prompt, 1024);
    answer = (answer || "").trim();

    // Detect the canonical refusal phrase (don't over-validate the answer in that case).
    const out_of_scope = answer.toLowerCase().includes(REFUSAL_PHRASE.toLowerCase());

    if (!out_of_scope) {
        // 7. Validate citations. Strip any [Chunk N] where N is outside our provided range.
        const validNums = new Set<number>(passing.map((_, i) => i + 1));
        const cited = parseCitations(answer);
        const stripped = stripInvalidCitations(answer, validNums);
        if (stripped.removed > 0) {
            logger.warn(`chat: removed ${stripped.removed} invalid citations from model output`);
        }
        answer = stripped.answer;

        // If the model produced an answer with ZERO valid citations, treat it as
        // suspect — better to refuse than to hallucinate confidently.
        const validCited = new Set([...cited].filter((n) => validNums.has(n)));
        if (validCited.size === 0) {
            logger.warn(`chat: model produced an answer with no valid citations — refusing`);
            return {
                answer: REFUSAL_PHRASE,
                sources: passing,
                confidence: "none",
                refused: true,
                out_of_scope: true,
                rewritten_query: standalone !== message ? standalone : undefined,
            };
        }
    }

    const citedNums = parseCitations(answer);
    const confidence = computeConfidence(passing, citedNums, out_of_scope);

    return {
        answer,
        sources: passing,
        confidence,
        refused: out_of_scope,
        out_of_scope,
        rewritten_query: standalone !== message ? standalone : undefined,
    };
};

// ---------- Streaming variant ----------

export type ChatStreamEvent =
    | { type: "prep"; rewritten_query?: string }
    | { type: "no_sources" }
    | { type: "delta"; text: string }
    | {
        type: "done";
        answer: string;
        sources: ChatSource[];
        confidence: ChatAnswer["confidence"];
        refused: boolean;
        out_of_scope: boolean;
        rewritten_query?: string;
    }
    | { type: "error"; message: string };

/**
 * Same pipeline, but yields events so the HTTP layer can SSE them straight to
 * the browser. Refusal happens BEFORE we start streaming whenever possible, so
 * the user never sees half-rendered hallucinations.
 */
export const runChatPipelineStream = async function* (
    params: ChatPipelineParams,
): AsyncGenerator<ChatStreamEvent, void, void> {
    const { userId, fileId, filename, history, message } = params;

    // 0. Pleasantry fast-path. Skip the whole pipeline; deliver immediately.
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
    const candidates = await retrieveChunks(userId, fileId, all, hyde, 20);
    if (isTableLikelyQuery(standalone)) {
        for (const c of candidates) if (c.has_table) c.score = Math.min(1, c.score * 1.15 + 0.05);
        candidates.sort((a, b) => b.score - a.score);
    }

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
        logger.error(`runChatPipelineStream: stream failed: ${e}`);
        yield { type: "error", message: "Streaming failed mid-response." };
        return;
    }

    let answer = buffer.trim();
    const outOfScope = answer.toLowerCase().includes(REFUSAL_PHRASE.toLowerCase());

    if (!outOfScope) {
        const valid = new Set<number>(passing.map((_, i) => i + 1));
        const cited = parseCitations(answer);
        const stripped = stripInvalidCitations(answer, valid);
        if (stripped.removed > 0) logger.warn(`stream: stripped ${stripped.removed} invalid citations`);
        answer = stripped.answer;
        const validCited = new Set([...cited].filter((n) => valid.has(n)));
        if (validCited.size === 0) {
            logger.warn(`stream: model produced no valid citations — refusing post-hoc`);
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
        confidence: computeConfidence(passing, parseCitations(answer), outOfScope),
        refused: outOfScope,
        out_of_scope: outOfScope,
        rewritten_query: standalone !== message ? standalone : undefined,
    };
};
