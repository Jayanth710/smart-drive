import getWeaviateClient from "../db/weaviate_client.js";
import { Filters } from 'weaviate-client';
import logger from "../logger.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";
import UserFile from "../models/userFileModel.js";

type SmartDriveSchema = {
    user_id: string;
    created_at: string;
    [key: string]: string;
};

// Parent summary collections (one row per file)
const summaryCollections: Record<string, string> = {
    Documents: "SmartDriveDocuments",
    Images: "SmartDriveImages",
    Media: "SmartDriveMedia",
};

// Chunk collections (many rows per file). Search hits chunks; we dedupe to parent.
const chunkCollections: Record<string, string> = {
    Documents: "SmartDriveDocumentChunks",
    Images: "SmartDriveImageChunks",
    Media: "SmartDriveMediaChunks",
};

// ---------- RRF fusion ----------
// Reciprocal Rank Fusion. Each signal contributes weight · (1 / (k + rank))
// per file. Multi-signal matches naturally score higher than single-signal
// wins. Calibration-free: doesn't matter that BM25 scores 0-30 while hybrid
// scores 0-1 — we fuse on RANK, not raw score.
const RRF_K = 60;

// Per-signal weights. Higher = signal is more trusted.
const SIGNAL_WEIGHTS: Record<string, number> = {
    "filename:full": 3.0,        // explicit filename paste → strongest signal
    "filename:tokenized": 2.0,   // descriptive query → filename match
    "chunk:bm25": 2.0,           // body lexical match (chunks)
    "summary:bm25": 2.0,         // summary lexical match
    "chunk:hybrid": 1.5,         // semantic chunk match (paraphrase)
    "raw_text:bm25": 1.5,        // body lexical fallback for unchatted files
};

type SignalEntry = { rank: number; properties: Record<string, unknown>; matched_chunk?: string };
type FileSignalMap = Map<string, Map<string, SignalEntry>>; // file_id → signal_name → entry

// ---------- Recency boost ----------
// Tiny exponential decay so recent files break ties for ambiguous queries
// without overriding genuine relevance. Capped at 8% of base RRF score.
const recencyBoost = (createdAt: unknown, baseScore: number): number => {
    if (!createdAt || (typeof createdAt !== "string" && !(createdAt instanceof Date))) return 0;
    const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
    if (!Number.isFinite(t)) return 0;
    const ageDays = Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
    // 30-day half-life. After 30 days the boost halves; after 90 days it's negligible.
    return baseScore * 0.08 * Math.exp(-ageDays / 30);
};

// ---------- R6: Personalization boost ----------
// Files the user actually interacts with (chat, view, download) rank higher
// for ambiguous queries. Two signals combined:
//   - access count: log-scaled so frequent files boost mildly, not unboundedly
//   - last-access recency: exp decay with 14-day half-life
// Capped at 12% of base score. Stronger than the upload-recency boost
// because explicit interaction is a stronger relevance signal.
const personalizationBoost = (
    accessCount: unknown,
    lastAccessedAt: unknown,
    baseScore: number,
): number => {
    const count = typeof accessCount === "number" ? accessCount : 0;
    if (count <= 0) return 0;
    let recencyFactor = 0.5; // default if no lastAccessedAt
    if (lastAccessedAt && (typeof lastAccessedAt === "string" || lastAccessedAt instanceof Date)) {
        const t = lastAccessedAt instanceof Date
            ? lastAccessedAt.getTime()
            : new Date(lastAccessedAt as string).getTime();
        if (Number.isFinite(t)) {
            const ageDays = Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
            recencyFactor = Math.exp(-ageDays / 14);
        }
    }
    // log(1+count) maps: 1 → 0.69, 5 → 1.79, 20 → 3.04, 100 → 4.62
    // Multiplied by recencyFactor (0-1), then scaled to max 0.12 of baseScore.
    const intensity = Math.log(1 + count) * recencyFactor;
    return baseScore * 0.12 * Math.min(1, intensity / 3);
};

// ---------- Result LRU cache ----------
// Repeat queries within a session (typing/refinement, common terms) skip
// the entire pipeline. 5-min TTL means the cache stays warm without serving
// stale data when files change frequently.
const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const RESULT_CACHE_MAX = 200;
type CacheEntry = { results: Record<string, unknown>[]; expiresAt: number };
const resultCache = new Map<string, CacheEntry>();

const resultCacheKey = (userId: string, query: string, collection: string): string => {
    return `${userId}|${collection}|${query.trim().toLowerCase()}`;
};

const resultCacheGet = (key: string): Record<string, unknown>[] | null => {
    const entry = resultCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        resultCache.delete(key);
        return null;
    }
    // LRU touch
    resultCache.delete(key);
    resultCache.set(key, entry);
    return entry.results;
};

const resultCacheSet = (key: string, results: Record<string, unknown>[]): void => {
    resultCache.set(key, { results, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });
    if (resultCache.size > RESULT_CACHE_MAX) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
    }
};

// Exported so chat / delete-file paths can invalidate when content changes.
// Cheap to call: O(n) scan but n is bounded at RESULT_CACHE_MAX.
export const invalidateUserSearchCache = (userId: string): void => {
    const prefix = `${userId}|`;
    for (const k of resultCache.keys()) {
        if (k.startsWith(prefix)) resultCache.delete(k);
    }
};

// ---------- R7: MMR diversity ----------
// Maximal Marginal Relevance — pick the next result by trading off "high
// relevance" against "low similarity to already-picked results". Prevents
// 5 near-duplicate file versions from dominating top 10. Uses filename
// token overlap as a cheap similarity proxy (avoiding an extra embed call).
const filenameTokens = (filename: string): Set<string> => {
    return new Set(
        (filename ?? "")
            .toLowerCase()
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .split(/[\s_\-.]+/)
            .filter((t) => t.length > 1),
    );
};

const tokenSetSimilarity = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / Math.min(a.size, b.size); // 0..1
};

const applyMMR = (
    candidates: Record<string, unknown>[],
    lambda: number = 0.7,
): Record<string, unknown>[] => {
    if (candidates.length <= 2) return candidates;
    const picked: Record<string, unknown>[] = [];
    const remaining = [...candidates];
    // Always pick the top-scored first.
    picked.push(remaining.shift()!);
    while (remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        const pickedTokens = picked.map((p) => filenameTokens(String(p.filename ?? "")));
        for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i];
            const candTokens = filenameTokens(String(cand.filename ?? ""));
            // max similarity to any already-picked
            let maxSim = 0;
            for (const pt of pickedTokens) {
                const sim = tokenSetSimilarity(candTokens, pt);
                if (sim > maxSim) maxSim = sim;
            }
            const mmr = lambda * (cand.score as number) - (1 - lambda) * maxSim;
            if (mmr > bestScore) {
                bestScore = mmr;
                bestIdx = i;
            }
        }
        picked.push(remaining.splice(bestIdx, 1)[0]);
    }
    return picked;
};

// Common English stopwords + search-intent verbs/pronouns. Dropped from
// queries before tokenized filename matching so the user's wrapper words
// ("I am searching for…") don't dilute meaningful tokens.
const STOPWORDS = new Set([
    "i", "me", "my", "mine", "we", "our", "ours",
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did",
    "for", "of", "to", "from", "with", "in", "on", "at", "by", "about",
    "and", "or", "but", "if", "as", "this", "that", "these", "those",
    "find", "show", "get", "search", "looking", "want", "need", "remember",
    "stored", "saved", "uploaded", "file", "files", "where", "which",
]);

/** Extract meaningful tokens from a conversational query.
 *  Keeps tokens of length ≥ 3 that aren't stopwords. Lowercased. */
const extractKeywords = (query: string): string[] => {
    const tokens = (query.toLowerCase().match(/\b\w+\b/g) ?? [])
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    // Dedupe while preserving order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    return out;
};

/**
 * Search pipeline — four signals, max-fusion.
 *
 *   (1) Chunk hybrid (BM25 + dense, score > 0.4) — for files that have
 *       chunks built (chatted with). Catches semantic + lexical body matches.
 *   (2) Filename substring (`like *q*`) — guarantees exact-filename hits even
 *       when BM25 tokenization would split the query. Fixed score 0.95.
 *   (3) Summary hybrid restricted to `summary` property ONLY — catches matches
 *       against the LLM-generated summary text (e.g. "IIT Guwahati" mentioned
 *       in a resume's summary). Strict 0.5 threshold so weak semantic matches
 *       don't pad results. Critical: queryProperties restriction prevents
 *       Weaviate from also searching raw_text (which caused "same results for
 *       every query" because short docs gamed BM25 length norm).
 *   (4) raw_text pure BM25 — strict lexical body fallback. Returns nothing
 *       for queries with no actual term match. Catches body content for
 *       files without chunks. No-ops if the property isn't index_searchable.
 *
 * Fuse via max(score). Drop nameless results, top 30.
 */
const queryWeaviate = async (userId: string, userQuery: string, queryCollection: string) => {
    try {
        // Check result cache first — same query within 5 minutes is free.
        const cacheKey = resultCacheKey(userId, userQuery, queryCollection);
        const cached = resultCacheGet(cacheKey);
        if (cached) {
            logger.info(`search: cache HIT for "${userQuery}" (${cached.length} results)`);
            return cached;
        }

        const client = await getWeaviateClient();
        if (!client) return [];

        // CRITICAL: build a cleaned BM25 query that strips conversational
        // stopwords. Raw user queries like "I am searching for a person who
        // studies at IIT" have 11 tokens, only 3 of which carry meaning. BM25
        // is OR-by-token: noise tokens pull in noise files. With cleaned
        // ["person", "studies", "iit"], the rare token "iit" (high IDF)
        // dominates and the resume wins reliably.
        //
        // Dense embedding still uses the original query — sentence embeddings
        // handle stopwords gracefully and conversational context can help.
        const keywords = extractKeywords(userQuery);
        const bm25Query = keywords.length > 0 ? keywords.join(" ") : userQuery;
        logger.info(`search: raw="${userQuery}" bm25="${bm25Query}" tokens=${keywords.length}`);

        const queryVector = await generateQueryEmbedding(userQuery);

        let pairs: { summary: string; chunks: string }[] = [];
        if (queryCollection === "SmartDrive" || queryCollection === "all") {
            pairs = Object.keys(summaryCollections).map((k) => ({
                summary: summaryCollections[k],
                chunks: chunkCollections[k],
            }));
        } else if (summaryCollections[queryCollection]) {
            pairs = [{
                summary: summaryCollections[queryCollection],
                chunks: chunkCollections[queryCollection],
            }];
        } else {
            logger.warn(`Unknown collection: ${queryCollection}`);
            return [];
        }

        // RRF data structure: file_id → signal_name → {rank, properties, matched_chunk}
        // Multiple signals per file lets RRF reward multi-signal matches.
        const fileSignals: FileSignalMap = new Map();

        const recordSignal = (
            signal: string,
            file_id: string,
            rank: number,
            properties: Record<string, unknown>,
            matched_chunk?: string,
        ) => {
            if (!file_id) return;
            let sigs = fileSignals.get(file_id);
            if (!sigs) {
                sigs = new Map();
                fileSignals.set(file_id, sigs);
            }
            // If the same signal already recorded a hit (from a different
            // collection), keep the better-ranked one.
            const existing = sigs.get(signal);
            if (!existing || rank < existing.rank) {
                sigs.set(signal, { rank, properties, matched_chunk });
            }
        };

        for (const { summary: summaryName, chunks: chunksName } of pairs) {
            // (1a) Chunk pure BM25 — only docs that actually contain the term.
            //      No dense, no noise. For rare-term queries this is what
            //      reliably ranks the right file at the top.
            if (await client.collections.exists(chunksName)) {
                try {
                    const chunkCol = client.collections.get<SmartDriveSchema>(chunksName);
                    const bm25Hits = await chunkCol.query.bm25(bm25Query, {
                        queryProperties: ["chunk_text"],
                        limit: 20,
                        filters: chunkCol.filter.byProperty("user_id").equal(userId),
                        returnMetadata: ['score'],
                    });
                    // Dedupe chunks → files: keep the highest-ranking chunk per file.
                    const seenFiles = new Set<string>();
                    let rank = 0;
                    for (const obj of bm25Hits.objects) {
                        const raw = obj.metadata?.score ?? 0;
                        if (raw <= 0) continue;
                        const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                        if (!fid || seenFiles.has(fid)) continue;
                        seenFiles.add(fid);
                        rank++;
                        recordSignal(
                            "chunk:bm25",
                            fid,
                            rank,
                            obj.properties as Record<string, unknown>,
                            String((obj.properties as { chunk_text?: string }).chunk_text ?? "") || undefined,
                        );
                    }
                } catch (err) {
                    logger.warn(`chunk bm25 on ${chunksName} failed: ${err}`);
                }
            }

            // (1b) Chunk hybrid — adds semantic recall for paraphrase queries.
            //      Strict 0.55 threshold so weak dense matches don't pad.
            if (await client.collections.exists(chunksName)) {
                try {
                    const chunkCol = client.collections.get<SmartDriveSchema>(chunksName);
                    const chunkHits = await chunkCol.query.hybrid(userQuery, {
                        vector: queryVector,
                        alpha: 0.5,
                        limit: 20,
                        filters: chunkCol.filter.byProperty("user_id").equal(userId),
                        returnMetadata: ['score'],
                    });
                    const seenFiles = new Set<string>();
                    let rank = 0;
                    for (const obj of chunkHits.objects) {
                        const score = obj.metadata?.score ?? 0;
                        if (score <= 0.55) continue;
                        const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                        if (!fid || seenFiles.has(fid)) continue;
                        seenFiles.add(fid);
                        rank++;
                        recordSignal(
                            "chunk:hybrid",
                            fid,
                            rank,
                            obj.properties as Record<string, unknown>,
                            String((obj.properties as { chunk_text?: string }).chunk_text ?? "") || undefined,
                        );
                    }
                } catch (err) {
                    logger.warn(`chunk hybrid on ${chunksName} failed: ${err}`);
                }
            }

            if (await client.collections.exists(summaryName)) {
                const sumCol = client.collections.get<SmartDriveSchema>(summaryName);

                // (2a) Filename FULL-string substring — for explicit-filename queries.
                try {
                    const filenameHits = await sumCol.query.fetchObjects({
                        limit: 10,
                        filters: Filters.and(
                            sumCol.filter.byProperty("user_id").equal(userId),
                            sumCol.filter.byProperty("filename").like(`*${userQuery}*`),
                        ),
                    });
                    let rank = 0;
                    for (const obj of filenameHits.objects) {
                        const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                        if (!fid) continue;
                        rank++;
                        recordSignal("filename:full", fid, rank, obj.properties as Record<string, unknown>);
                    }
                } catch (err) {
                    logger.warn(`filename match on ${summaryName} failed: ${err}`);
                }

                // (2b) Filename TOKENIZED match — for descriptive queries like
                //      "I'm looking for my undergrad transcripts" → tokens
                //      [undergrad, transcripts] → OR-match each against filename.
                //      Catches Undergrad_Transcripts.pdf even when the file has
                //      no summary or chunks. Score reflects # of tokens matched.
                if (keywords.length > 0) {
                    try {
                        const orParts = keywords.map((kw) =>
                            sumCol.filter.byProperty("filename").like(`*${kw}*`),
                        );
                        const tokenHits = await sumCol.query.fetchObjects({
                            limit: 20,
                            filters: Filters.and(
                                sumCol.filter.byProperty("user_id").equal(userId),
                                orParts.length === 1 ? orParts[0] : Filters.or(...orParts),
                            ),
                        });
                        // Sort by # of matched keywords so the most-relevant filename ranks first.
                        const scored: { obj: typeof tokenHits.objects[number]; matched: number }[] = [];
                        for (const obj of tokenHits.objects) {
                            const props = obj.properties as { file_id?: string; filename?: string };
                            const fid = String(props.file_id ?? "");
                            if (!fid) continue;
                            const filenameLower = String(props.filename ?? "").toLowerCase();
                            const matchedCount = keywords.filter((kw) => filenameLower.includes(kw)).length;
                            if (matchedCount === 0) continue;
                            scored.push({ obj, matched: matchedCount });
                        }
                        scored.sort((a, b) => b.matched - a.matched);
                        let rank = 0;
                        for (const { obj } of scored) {
                            const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                            rank++;
                            recordSignal("filename:tokenized", fid, rank, obj.properties as Record<string, unknown>);
                        }
                    } catch (err) {
                        logger.warn(`filename token match on ${summaryName} failed: ${err}`);
                    }
                }

                // (3) Summary PURE BM25 — only docs that actually contain the
                //     term in the summary. NOT hybrid: hybrid includes dense-only
                //     matches and Weaviate's score normalization can rank a
                //     dense-noise match higher than a real BM25 win. For a query
                //     like "Indraneel" (rare proper noun, only in the resume's
                //     summary), pure BM25 returns ONLY the resume — no padding.
                try {
                    const summaryHits = await sumCol.query.bm25(bm25Query, {
                        queryProperties: ["summary"],
                        limit: 20,
                        filters: sumCol.filter.byProperty("user_id").equal(userId),
                        returnMetadata: ['score'],
                    });
                    let rank = 0;
                    for (const obj of summaryHits.objects) {
                        const raw = obj.metadata?.score ?? 0;
                        if (raw <= 0) continue;
                        const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                        if (!fid) continue;
                        rank++;
                        recordSignal("summary:bm25", fid, rank, obj.properties as Record<string, unknown>);
                    }
                } catch (err) {
                    logger.warn(`summary bm25 on ${summaryName} failed: ${err}`);
                }

                // (4) raw_text pure BM25 — strict lexical match in document body.
                //     This is the fallback for files without chunks (most files,
                //     since chunks are lazy). No dense vector — purely
                //     "does the doc actually contain these words". The signal
                //     returns nothing for queries that have no term match.
                //     Will silently no-op if raw_text isn't index_searchable.
                try {
                    // R3: prefer the new `body_text` property (index_searchable=true)
                    // over `raw_text` (storage-only). New ingests populate both;
                    // older rows still have raw_text only.
                    const rawHits = await sumCol.query.bm25(bm25Query, {
                        queryProperties: ["body_text", "raw_text"],
                        limit: 20,
                        filters: sumCol.filter.byProperty("user_id").equal(userId),
                        returnMetadata: ['score'],
                    });
                    let rank = 0;
                    for (const obj of rawHits.objects) {
                        const raw = obj.metadata?.score ?? 0;
                        if (raw <= 0) continue;
                        const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                        if (!fid) continue;
                        rank++;
                        recordSignal("raw_text:bm25", fid, rank, obj.properties as Record<string, unknown>);
                    }
                } catch (err) {
                    logger.warn(`raw_text bm25 on ${summaryName} failed (property may not be searchable): ${err}`);
                }
            }
        }

        if (fileSignals.size === 0) {
            logger.info(`search: 0 results for "${userQuery}"`);
            resultCacheSet(cacheKey, []);
            return [];
        }

        // ---------- RRF fusion ----------
        // For each file, sum weighted 1/(k+rank) across every signal it appears in.
        // This rewards files matched by multiple signals — exactly the "the
        // file we're looking for shows up in chunks AND filename AND summary"
        // case that max-fusion missed.
        // R6 — fetch personalization data (accessCount, lastAccessedAt) for
        // candidate files in one Mongo round-trip. Skipped if no signals fired.
        const candidateIds = [...fileSignals.keys()];
        const personalizationMap = new Map<string, { accessCount: number; lastAccessedAt: Date | null }>();
        if (candidateIds.length > 0) {
            try {
                const personalizationDocs = await UserFile.find(
                    { _id: { $in: candidateIds }, userId },
                    { _id: 1, accessCount: 1, lastAccessedAt: 1 },
                ).lean();
                for (const doc of personalizationDocs) {
                    personalizationMap.set(doc._id.toString(), {
                        accessCount: (doc as { accessCount?: number }).accessCount ?? 0,
                        lastAccessedAt: (doc as { lastAccessedAt?: Date }).lastAccessedAt ?? null,
                    });
                }
            } catch (err) {
                logger.warn(`personalization lookup failed (continuing without boost): ${err}`);
            }
        }

        const merged: Record<string, unknown>[] = [];
        for (const [fid, sigs] of fileSignals.entries()) {
            let score = 0;
            let bestProps: Record<string, unknown> = {};
            let bestChunk: string | undefined;
            const matchedIn: string[] = [];
            for (const [signalName, entry] of sigs.entries()) {
                const weight = SIGNAL_WEIGHTS[signalName] ?? 1.0;
                score += weight * (1 / (RRF_K + entry.rank));
                matchedIn.push(signalName);
                if (signalName.startsWith("filename:") || signalName.startsWith("summary:") || signalName.startsWith("raw_text:")) {
                    bestProps = entry.properties;
                } else if (Object.keys(bestProps).length === 0) {
                    bestProps = entry.properties;
                }
                if (!bestChunk && entry.matched_chunk) bestChunk = entry.matched_chunk;
            }

            // Recency boost (upload age) — capped 8%.
            const recBoost = recencyBoost(bestProps.created_at, score);
            // R6 — personalization boost (user interaction history) — capped 12%.
            const personalization = personalizationMap.get(fid);
            const personBoost = personalization
                ? personalizationBoost(personalization.accessCount, personalization.lastAccessedAt, score)
                : 0;

            const row: Record<string, unknown> = {
                ...bestProps,
                file_id: fid,
                score: score + recBoost + personBoost,
                matched_chunk: bestChunk,
                matched_in: matchedIn,
            };
            if (typeof row.filename === "string" && (row.filename as string).length > 0) {
                merged.push(row);
            }
        }
        merged.sort((a, b) => (b.score as number) - (a.score as number));
        // R7 — MMR diversification on the top 30. Filename-token similarity
        // is the cheap proxy. lambda=0.7 keeps the relevance bias high while
        // breaking up near-duplicates (file v1, v2, v3 etc).
        const rerankPool = merged.slice(0, 30);
        const diversified = applyMMR(rerankPool, 0.7);

        const topScore = diversified.length > 0 ? (diversified[0].score as number).toFixed(4) : "n/a";
        const topFile = diversified.length > 0 ? String(diversified[0].filename ?? "?") : "n/a";
        logger.info(`search: ${diversified.length} results for "${userQuery}" (top=${topFile} @ ${topScore})`);

        resultCacheSet(cacheKey, diversified);
        return diversified;
    } catch (error) {
        logger.error('queryWeaviate failed:', error);
        return { status: 500, error: 'Search failed due to an internal error.' };
    }
};

const getRecentUploads = async (userId: string, queryCollection: string) => {
    try {
        const client = await getWeaviateClient();
        if (!client) {
            logger.error("Client not initialized");
            return;
        }

        let collectionsToQuery: string[] = [];
        if (queryCollection === "all") {
            collectionsToQuery = Object.values(summaryCollections);
        } else if (summaryCollections[queryCollection]) {
            collectionsToQuery = [summaryCollections[queryCollection]];
        } else {
            logger.warn(`Unknown collection: ${queryCollection}`);
            return [];
        }
        const results: SmartDriveSchema[] = [];
        for (const collectionName of collectionsToQuery) {
            const exists = await client.collections.exists(collectionName);
            if (!exists) continue;
            const collection = client.collections.get<SmartDriveSchema>(collectionName);
            const res = await collection.query.fetchObjects({
                limit: 50,
                filters: collection.filter.byProperty("user_id").equal(userId),
                sort: collection.sort.byProperty("created_at" as string, false),
            });
            results.push(...res.objects.map((obj) => obj.properties as SmartDriveSchema));
        }
        results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return results;
    } catch (error) {
        logger.error("getRecentUploads error:", error);
        return [];
    }
};

const deleteWeaviateFile = async (
    userId: string,
    fileId: string | undefined,
    summaryCollection: string,
): Promise<boolean> => {
    if (!fileId) {
        logger.error('No fileRecord found');
        return false;
    }
    try {
        const client = await getWeaviateClient();
        if (!client) return false;

        // Delete both the parent summary row AND any per-chunk vectors.
        const chunkCollection = Object.entries(summaryCollections).find(
            ([, v]) => v === summaryCollection,
        )?.[0];
        const chunkCollectionName = chunkCollection ? chunkCollections[chunkCollection] : undefined;

        const deleteFrom = async (name: string) => {
            if (!(await client.collections.exists(name))) return;
            const col = client.collections.get(name);
            const filters = Filters.and(
                col.filter.byProperty("user_id").equal(userId),
                col.filter.byProperty("file_id").equal(fileId),
            );
            const resp = await col.query.fetchObjects({ limit: 100, filters });
            for (const obj of resp.objects) {
                await col.data.deleteById(obj.uuid);
            }
            if (resp.objects.length > 0) {
                logger.info(`Deleted ${resp.objects.length} objects from ${name} for fileId=${fileId}`);
            }
        };

        await deleteFrom(summaryCollection);
        if (chunkCollectionName) await deleteFrom(chunkCollectionName);

        // Invalidate cached search results so deleted files don't keep
        // showing up in cached query responses for the next 5 minutes.
        invalidateUserSearchCache(userId);

        return true;
    } catch (error) {
        logger.error(`deleteWeaviateFile fileId=${fileId} failed:`, error);
        return false;
    }
};

const deleteWeaviateUser = async (userId: string) => {
    if (!userId) {
        logger.info(`${userId} not passed. Skipping deletion`);
        return;
    }
    try {
        const client = await getWeaviateClient();
        if (!client) {
            logger.error("Client not initialized");
            return;
        }
        const all = [...Object.values(summaryCollections), ...Object.values(chunkCollections)];
        for (const collectionName of all) {
            if (!(await client.collections.exists(collectionName))) continue;
            const collection = client.collections.get(collectionName);
            await collection.data.deleteMany(
                collection.filter.byProperty("user_id").equal(userId),
            );
            logger.info(`Deleted ${userId} data from ${collectionName}`);
        }
    } catch (error) {
        logger.error(`deleteWeaviateUser ${userId} failed: ${error}`);
    }
};

export type FileEnrichment = {
    summary?: string;
    indexJson?: Record<string, unknown>;
};

const safeParseIndexJson = (raw: unknown): Record<string, unknown> | undefined => {
    if (!raw || typeof raw !== 'string') return undefined;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    } catch {
        return undefined;
    }
};

const getWeaviateSummariesByFileIds = async (
    userId: string,
    fileIds: string[],
): Promise<Map<string, FileEnrichment>> => {
    const out = new Map<string, FileEnrichment>();
    if (fileIds.length === 0) return out;
    try {
        const client = await getWeaviateClient();
        if (!client) return out;
        for (const name of Object.values(summaryCollections)) {
            const exists = await client.collections.exists(name);
            if (!exists) continue;
            const collection = client.collections.get<SmartDriveSchema>(name);
            const res = await collection.query.fetchObjects({
                limit: fileIds.length,
                filters: Filters.and(
                    collection.filter.byProperty('user_id').equal(userId),
                    collection.filter.byProperty('file_id').containsAny(fileIds),
                ),
            });
            for (const obj of res.objects) {
                const props = obj.properties as { file_id?: string; summary?: string; index_json?: string };
                if (!props.file_id || out.has(props.file_id)) continue;
                out.set(props.file_id, {
                    summary: props.summary,
                    indexJson: safeParseIndexJson(props.index_json),
                });
            }
        }
    } catch (error) {
        logger.error('Failed to fetch Weaviate enrichments:', error);
    }
    return out;
};

/**
 * Hybrid-search chunks belonging to a single file. Used by "Chat with file"
 * to pull only the chunks relevant to a question.
 */
const getFileChunksByQuery = async (
    userId: string,
    fileId: string,
    question: string,
    k = 6,
): Promise<{ chunk_index: number; chunk_text: string; score: number }[]> => {
    try {
        const client = await getWeaviateClient();
        if (!client) return [];
        const queryVector = await generateQueryEmbedding(question);

        const hits: { chunk_index: number; chunk_text: string; score: number }[] = [];
        for (const name of Object.values(chunkCollections)) {
            if (!(await client.collections.exists(name))) continue;
            const col = client.collections.get<SmartDriveSchema>(name);
            const res = await col.query.hybrid(question, {
                vector: queryVector,
                alpha: 0.5,
                limit: k,
                filters: Filters.and(
                    col.filter.byProperty("user_id").equal(userId),
                    col.filter.byProperty("file_id").equal(fileId),
                ),
                returnMetadata: ['score'],
            });
            for (const obj of res.objects) {
                const props = obj.properties as { chunk_index?: number; chunk_text?: string };
                hits.push({
                    chunk_index: Number(props.chunk_index ?? 0),
                    chunk_text: String(props.chunk_text ?? ""),
                    score: obj.metadata?.score ?? 0,
                });
            }
        }
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, k);
    } catch (err) {
        logger.error(`getFileChunksByQuery failed for fileId=${fileId}: ${err}`);
        return [];
    }
};

/**
 * Fall back to the parent summary row's raw_text when a file was indexed
 * before per-chunk vectors existed.
 */
const getFileRawText = async (userId: string, fileId: string): Promise<string> => {
    try {
        const client = await getWeaviateClient();
        if (!client) return "";
        for (const name of Object.values(summaryCollections)) {
            if (!(await client.collections.exists(name))) continue;
            const col = client.collections.get<SmartDriveSchema>(name);
            const res = await col.query.fetchObjects({
                limit: 1,
                filters: Filters.and(
                    col.filter.byProperty("user_id").equal(userId),
                    col.filter.byProperty("file_id").equal(fileId),
                ),
            });
            const obj = res.objects[0];
            if (!obj) continue;
            const props = obj.properties as { raw_text?: string; summary?: string };
            return String(props.raw_text || props.summary || "");
        }
    } catch (err) {
        logger.warn(`getFileRawText fileId=${fileId} failed: ${err}`);
    }
    return "";
};

export {
    queryWeaviate,
    getRecentUploads,
    deleteWeaviateFile,
    deleteWeaviateUser,
    getWeaviateSummariesByFileIds,
    getFileChunksByQuery,
    getFileRawText,
};
