/**
 * Search pipeline — multi-signal retrieval + RRF fusion + optional rerank.
 *
 * Architecture:
 *   1. analyzeQuery — detects filename vs content vs recency intent, extracts phrases
 *   2. Parallel signals:
 *      (a) chunk hybrid (BM25 + vector)        → covers semantic + body text
 *      (b) filename BM25 over tokenized name   → covers "find file named …"
 *      (c) summary hybrid                       → covers paraphrased queries against the LLM summary
 *      (d) entity / date / doc_id structured    → high-precision facts
 *   3. RRF fusion with intent-based per-signal weights (k=60)
 *   4. Recency boost (small) on top of fused rank
 *   5. Optional cross-encoder / LLM rerank for top-30 (off by default; latency cost)
 */

import { Filters } from "weaviate-client";
import getWeaviateClient from "../db/weaviate_client.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";
import { extractQueryEntities } from "./queryEntityExtractor.js";
import logger from "../logger.js";

// ---------- types ----------

type Intent = {
    filename: boolean;
    recency: boolean;
    content: boolean;
    exactPhrases: string[];
};

export type QueryAnalysis = {
    raw: string;
    cleaned: string;
    intent: Intent;
};

type SignalHit = {
    file_id: string;
    rank: number; // 1-based
    matched_chunk?: string;
};

type FusedHit = {
    file_id: string;
    score: number;
    matched_in: string[];
    matched_chunk?: string;
    matched_entities?: string[];
    matched_dates?: string[];
    matched_doc_ids?: string[];
};

export type SearchResult = FusedHit & {
    [key: string]: unknown;
};

// ---------- 1. Query analyzer ----------

const STOPWORDS = new Set([
    "find", "show", "me", "get", "search", "the", "a", "an", "please",
    "for", "of", "to", "with", "about", "i", "we", "want", "need",
]);

const FILENAME_HINTS = /\.\w{2,5}(\s|$)|[_\-]|[a-z][A-Z]|[A-Z]{2,}/;

const RECENCY_HINTS = /\b(recent|latest|today|yesterday|this\s+week|last\s+week|new(est)?|just\s+uploaded)\b/i;

export const analyzeQuery = (raw: string): QueryAnalysis => {
    const trimmed = raw.trim();

    // 1. Pull quoted phrases out — these must match exactly in some signal.
    const exactPhrases: string[] = [];
    const phraseRe = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = phraseRe.exec(trimmed))) exactPhrases.push(m[1].trim());
    const unquoted = trimmed.replace(/"[^"]+"/g, " ").replace(/\s+/g, " ").trim();

    // 2. Strip conversational stopwords for retrieval, but keep raw form for filename/exact match.
    const cleaned = unquoted
        .split(/\s+/)
        .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))
        .join(" ")
        .trim() || unquoted;

    // 3. Intent classification.
    const filename = FILENAME_HINTS.test(unquoted);
    const recency = RECENCY_HINTS.test(unquoted);
    const content = !filename || cleaned.split(/\s+/).length > 1;

    return {
        raw: trimmed,
        cleaned,
        intent: { filename, recency, content, exactPhrases },
    };
};

// ---------- 2. Tokenize filenames for BM25 ----------

/** Tokenize `DS_Cheat-Sheet_v2.pdf` → ['ds','cheat','sheet','v2','pdf']. */
export const tokenizeFilename = (name: string): string[] => {
    if (!name) return [];
    return name
        .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
        .split(/[\s_\-.]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length > 1);
};

// ---------- 3. RRF fusion ----------

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion. Each signal contributes weight·(1 / (k + rank)) per file.
 * Per-signal weights let us bias the fusion by detected intent
 * (e.g. boost filename signal 2x when the query looks like a filename).
 */
export const rrfFuse = (
    signals: { name: string; hits: SignalHit[]; weight: number }[],
    k: number = RRF_K,
): Map<string, { score: number; matched_in: Set<string>; bestChunk?: string }> => {
    const acc = new Map<string, { score: number; matched_in: Set<string>; bestChunk?: string }>();
    for (const { name, hits, weight } of signals) {
        for (const hit of hits) {
            const cur = acc.get(hit.file_id) ?? {
                score: 0,
                matched_in: new Set<string>(),
                bestChunk: undefined,
            };
            cur.score += weight * (1 / (k + hit.rank));
            cur.matched_in.add(name);
            if (!cur.bestChunk && hit.matched_chunk) cur.bestChunk = hit.matched_chunk;
            acc.set(hit.file_id, cur);
        }
    }
    return acc;
};

// ---------- 4. Recency boost ----------

/** Small bump (max ~5% of RRF top score) for files uploaded recently. Never dominates relevance. */
const recencyBoost = (createdAt: unknown, baseScore: number): number => {
    if (!createdAt || typeof createdAt !== "string") return 0;
    const t = new Date(createdAt).getTime();
    if (!Number.isFinite(t)) return 0;
    const ageDays = Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
    // Half-life of 30 days. Boost = baseScore · 0.05 · exp(-age/30)
    return baseScore * 0.05 * Math.exp(-ageDays / 30);
};

// ---------- 5. Parallel signal collection ----------

type WClient = Awaited<ReturnType<typeof getWeaviateClient>>;

const chunkHybridSignal = async (
    client: NonNullable<WClient>,
    chunksName: string,
    userId: string,
    query: string,
    vector: number[],
): Promise<SignalHit[]> => {
    if (!(await client.collections.exists(chunksName))) return [];
    const col = client.collections.get(chunksName);
    const res = await col.query.hybrid(query, {
        vector,
        alpha: 0.5,
        limit: 50,
        filters: col.filter.byProperty("user_id").equal(userId),
        returnMetadata: ["score"],
    });
    // Collapse to one rank per file — keep the best-ranked chunk per file.
    const seen = new Map<string, SignalHit>();
    let rank = 1;
    for (const obj of res.objects) {
        const p = obj.properties as { file_id?: string; chunk_text?: string };
        const fid = String(p.file_id ?? "");
        if (!fid || seen.has(fid)) { rank++; continue; }
        seen.set(fid, { file_id: fid, rank: rank++, matched_chunk: p.chunk_text });
    }
    return [...seen.values()];
};

const filenameBM25Signal = async (
    client: NonNullable<WClient>,
    summaryName: string,
    userId: string,
    query: string,
): Promise<SignalHit[]> => {
    if (!(await client.collections.exists(summaryName))) return [];
    const col = client.collections.get(summaryName);
    try {
        const res = await col.query.bm25(query, {
            queryProperties: ["filename"],
            limit: 50,
            filters: col.filter.byProperty("user_id").equal(userId),
            returnMetadata: ["score"],
        });
        let rank = 1;
        return res.objects.map((obj) => {
            const p = obj.properties as { file_id?: string };
            return { file_id: String(p.file_id ?? ""), rank: rank++ };
        }).filter((h) => h.file_id);
    } catch (e) {
        logger.warn(`filenameBM25Signal on ${summaryName} failed (collection may lack BM25 index on filename): ${e}`);
        return [];
    }
};

const summaryHybridSignal = async (
    client: NonNullable<WClient>,
    summaryName: string,
    userId: string,
    query: string,
    vector: number[],
): Promise<SignalHit[]> => {
    if (!(await client.collections.exists(summaryName))) return [];
    const col = client.collections.get(summaryName);
    try {
        const res = await col.query.hybrid(query, {
            vector,
            alpha: 0.5,
            limit: 50,
            filters: col.filter.byProperty("user_id").equal(userId),
            returnMetadata: ["score"],
        });
        let rank = 1;
        return res.objects.map((obj) => {
            const p = obj.properties as { file_id?: string };
            return { file_id: String(p.file_id ?? ""), rank: rank++ };
        }).filter((h) => h.file_id);
    } catch {
        // Older summary collections may not have a summary embedding — that's fine.
        return [];
    }
};

const entitySignal = async (
    client: NonNullable<WClient>,
    summaryName: string,
    userId: string,
    qe: { entities: string[]; dates: string[]; doc_ids: string[]; topics: string[] },
): Promise<{
    hits: SignalHit[];
    matches: Map<string, { entities: string[]; dates: string[]; doc_ids: string[] }>;
}> => {
    const matches = new Map<string, { entities: string[]; dates: string[]; doc_ids: string[] }>();
    if (!(await client.collections.exists(summaryName))) return { hits: [], matches };
    const col = client.collections.get(summaryName);
    const orParts = [];
    if (qe.entities.length) orParts.push(col.filter.byProperty("entities").containsAny(qe.entities));
    if (qe.dates.length) orParts.push(col.filter.byProperty("dates").containsAny(qe.dates));
    if (qe.doc_ids.length) orParts.push(col.filter.byProperty("doc_ids").containsAny(qe.doc_ids));
    if (qe.topics.length) orParts.push(col.filter.byProperty("topics").containsAny(qe.topics));
    if (orParts.length === 0) return { hits: [], matches };
    try {
        const res = await col.query.fetchObjects({
            limit: 50,
            filters: Filters.and(
                col.filter.byProperty("user_id").equal(userId),
                Filters.or(...orParts),
            ),
        });
        // Rank by # of matched signals (more matches = higher rank).
        const scored = res.objects
            .map((obj) => {
                const p = obj.properties as {
                    file_id?: string;
                    entities?: string[];
                    dates?: string[];
                    doc_ids?: string[];
                    topics?: string[];
                };
                const fid = String(p.file_id ?? "");
                if (!fid) return null;
                const me = qe.entities.filter((e) => (p.entities ?? []).includes(e));
                const md = qe.dates.filter((d) => (p.dates ?? []).includes(d));
                const mi = qe.doc_ids.filter((d) => (p.doc_ids ?? []).includes(d));
                const mt = qe.topics.filter((t) => (p.topics ?? []).includes(t));
                return { fid, total: me.length + md.length + mi.length + mt.length, me, md, mi };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => b.total - a.total);
        const hits: SignalHit[] = scored.map((s, i) => ({ file_id: s.fid, rank: i + 1 }));
        for (const s of scored) {
            matches.set(s.fid, { entities: s.me, dates: s.md, doc_ids: s.mi });
        }
        return { hits, matches };
    } catch (e) {
        // Older collections may not have the array fields — degrade gracefully.
        logger.warn(`entitySignal on ${summaryName} failed: ${e}`);
        return { hits: [], matches };
    }
};

// ---------- 6. Orchestrator ----------

const intentWeights = (intent: Intent): { chunk: number; filename: number; summary: number; entity: number } => {
    // Defaults are balanced. Filename intent boosts filename + summary (where the name lives).
    // Pure content intent boosts chunk/body.
    if (intent.filename) return { chunk: 1.0, filename: 2.5, summary: 1.5, entity: 1.5 };
    if (intent.exactPhrases.length > 0) return { chunk: 2.0, filename: 1.0, summary: 1.5, entity: 2.0 };
    return { chunk: 1.5, filename: 1.0, summary: 1.0, entity: 1.5 };
};

export const runSearchPipeline = async (
    userId: string,
    rawQuery: string,
    pairs: { summary: string; chunks: string }[],
): Promise<SearchResult[]> => {
    const analysis = analyzeQuery(rawQuery);
    const queryForRetrieval = analysis.cleaned || analysis.raw;

    const client = await getWeaviateClient();
    if (!client) return [];

    // Embedding + entity extraction run in parallel — both are slow network calls.
    const [queryVector, qe] = await Promise.all([
        generateQueryEmbedding(queryForRetrieval),
        extractQueryEntities(queryForRetrieval).catch(() => null),
    ]);

    const weights = intentWeights(analysis.intent);
    logger.info(
        `search: q="${rawQuery}" intent=` +
        `${analysis.intent.filename ? "FILENAME " : ""}` +
        `${analysis.intent.recency ? "RECENT " : ""}` +
        `${analysis.intent.content ? "CONTENT " : ""}` +
        `phrases=${analysis.intent.exactPhrases.length} ` +
        `weights=${JSON.stringify(weights)}`,
    );

    // Run all signals across all collection pairs in parallel.
    type SignalBlock = { name: string; hits: SignalHit[]; weight: number };
    const allSignals: SignalBlock[] = [];
    const entityMatchByFile = new Map<string, { entities: string[]; dates: string[]; doc_ids: string[] }>();

    await Promise.all(pairs.flatMap(({ summary: summaryName, chunks: chunksName }) => [
        chunkHybridSignal(client, chunksName, userId, queryForRetrieval, queryVector)
            .then((hits) => allSignals.push({ name: "content", hits, weight: weights.chunk })),
        filenameBM25Signal(client, summaryName, userId, queryForRetrieval)
            .then((hits) => allSignals.push({ name: "filename", hits, weight: weights.filename })),
        summaryHybridSignal(client, summaryName, userId, queryForRetrieval, queryVector)
            .then((hits) => allSignals.push({ name: "summary", hits, weight: weights.summary })),
        (async () => {
            if (!qe || (!qe.entities.length && !qe.dates.length && !qe.doc_ids.length && !qe.topics.length)) {
                return;
            }
            const { hits, matches } = await entitySignal(client, summaryName, userId, qe);
            allSignals.push({ name: "entities", hits, weight: weights.entity });
            for (const [fid, m] of matches) entityMatchByFile.set(fid, m);
        })(),
    ]));

    // Fuse.
    const fused = rrfFuse(allSignals);
    if (fused.size === 0) {
        logger.info(`search: 0 results for "${rawQuery}"`);
        return [];
    }

    // Enrich with parent summary properties so the UI gets filename, summary, created_at, etc.
    const fileIds = [...fused.keys()];
    const summariesByFile = new Map<string, Record<string, unknown>>();
    await Promise.all(pairs.map(async ({ summary: summaryName }) => {
        if (!(await client.collections.exists(summaryName))) return;
        const col = client.collections.get(summaryName);
        const res = await col.query.fetchObjects({
            limit: fileIds.length,
            filters: Filters.and(
                col.filter.byProperty("user_id").equal(userId),
                col.filter.byProperty("file_id").containsAny(fileIds),
            ),
        });
        for (const obj of res.objects) {
            const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
            if (fid && !summariesByFile.has(fid)) {
                summariesByFile.set(fid, obj.properties as Record<string, unknown>);
            }
        }
    }));

    // Final scoring: fused RRF score + recency boost (if intent suggests it).
    const recencyMultiplier = analysis.intent.recency ? 3 : 1;
    const results: SearchResult[] = fileIds.map((fid) => {
        const f = fused.get(fid)!;
        const parent = summariesByFile.get(fid) ?? {};
        const boost = recencyMultiplier * recencyBoost(parent.created_at, f.score);
        const entityMatch = entityMatchByFile.get(fid);
        return {
            ...parent,
            file_id: fid,
            score: f.score + boost,
            matched_in: [...f.matched_in],
            matched_chunk: f.bestChunk,
            matched_entities: entityMatch?.entities.length ? entityMatch.entities : undefined,
            matched_dates: entityMatch?.dates.length ? entityMatch.dates : undefined,
            matched_doc_ids: entityMatch?.doc_ids.length ? entityMatch.doc_ids : undefined,
        };
    });

    results.sort((a, b) => b.score - a.score);
    logger.info(`search: ${results.length} results for "${rawQuery}" (top score=${results[0]?.score.toFixed(4)})`);

    // Cap to a reasonable top-K — UI doesn't need 200 results.
    return results.slice(0, 30);
};

// ---------- 7. Optional LLM rerank for the top results ----------

/**
 * Re-rank top candidates by feeding (query, filename + summary snippet) to an LLM.
 * Adds 500-1500ms of latency. Off by default; opt in via SEARCH_RERANK=on env var.
 * Caller is responsible for invoking this only when latency budget allows.
 */
export const llmRerankSearchResults = async (
    query: string,
    results: SearchResult[],
    keep: number,
    geminiJSON: <T>(
        prompt: string,
        schema: Record<string, unknown>,
        maxTokens: number,
        label: string,
    ) => Promise<T | null>,
): Promise<SearchResult[]> => {
    if (results.length <= keep) return results;
    const pool = results.slice(0, Math.min(20, results.length));
    const formatted = pool.map((r, i) => {
        const fn = String(r.filename ?? "");
        const sum = String(r.summary ?? "").slice(0, 400);
        const chunk = r.matched_chunk ? String(r.matched_chunk).slice(0, 200) : "";
        return `[${i}] filename: ${fn}\nsummary: ${sum}${chunk ? `\nmatched: ${chunk}` : ""}`;
    }).join("\n\n---\n\n");

    const SCHEMA = {
        type: "OBJECT",
        properties: {
            scores: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        idx: { type: "INTEGER" },
                        score: { type: "INTEGER", description: "0-10 relevance to the query." },
                    },
                    required: ["idx", "score"],
                },
            },
        },
        required: ["scores"],
    };

    try {
        const out = await geminiJSON<{ scores: { idx: number; score: number }[] }>(
            `Rate each file's relevance to the search query on a 0-10 scale.
Query: "${query}"

Files:
${formatted}

Output one score per file in the same order, referencing each by its idx.`,
            SCHEMA,
            1024,
            "search:rerank",
        );
        const map = new Map<number, number>();
        for (const s of out?.scores ?? []) map.set(s.idx, s.score);
        const reranked = pool
            .map((r, i) => ({ r, s: map.get(i) ?? -1 }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.r);
        // Tail (positions 21+) keeps RRF order — we didn't rerank them.
        return [...reranked.slice(0, keep), ...results.slice(pool.length)];
    } catch (e) {
        logger.warn(`llmRerankSearchResults failed: ${e}`);
        return results;
    }
};
