import getWeaviateClient from "../db/weaviate_client.js";
import { Filters } from 'weaviate-client';
import logger from "../logger.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";
import { extractQueryEntities } from "./queryEntityExtractor.js";

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

type ScoredHit = {
    file_id: string;
    score: number;
    properties: Record<string, unknown>;
    matched_chunk?: string;
    matched_entities?: string[];
    matched_dates?: string[];
    matched_doc_ids?: string[];
};

const queryWeaviate = async (userId: string, userQuery: string, queryCollection: string) => {
    try {
        const client = await getWeaviateClient();
        if (!client) return [];

        // Kick off entity extraction in parallel with the embedding call.
        // Entity extraction is best-effort — if it fails we just fall back to
        // pure hybrid search.
        const [queryVector, qe] = await Promise.all([
            generateQueryEmbedding(userQuery),
            extractQueryEntities(userQuery).catch(() => null),
        ]);

        const hasEntitySignals = !!(qe && (
            qe.entities.length || qe.dates.length || qe.doc_ids.length || qe.topics.length
        ));
        if (hasEntitySignals) {
            logger.info(
                `queryWeaviate: extracted filters ` +
                `entities=${qe!.entities.length} dates=${qe!.dates.length} ` +
                `doc_ids=${qe!.doc_ids.length} topics=${qe!.topics.length}`,
            );
        }

        let pairs: { summary: string; chunks: string }[] = [];
        if (queryCollection === "SmartDrive") {
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

        // Map file_id → best hit so we collapse chunk matches to one row per file.
        const bestByFile = new Map<string, ScoredHit>();

        const upsertHit = (hit: ScoredHit) => {
            const existing = bestByFile.get(hit.file_id);
            if (!existing || hit.score > existing.score) {
                bestByFile.set(hit.file_id, hit);
            }
        };

        for (const { summary: summaryName, chunks: chunksName } of pairs) {
            // 1) Chunk-level hybrid search — this is where the semantic recall lives now.
            if (await client.collections.exists(chunksName)) {
                const chunkCol = client.collections.get<SmartDriveSchema>(chunksName);
                const chunkHits = await chunkCol.query.hybrid(userQuery, {
                    vector: queryVector,
                    alpha: 0.5,
                    limit: 20,
                    filters: chunkCol.filter.byProperty("user_id").equal(userId),
                    returnMetadata: ['score'],
                });
                for (const obj of chunkHits.objects) {
                    const score = obj.metadata?.score ?? 0;
                    if (score <= 0.4) continue;
                    const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                    if (!fid) continue;
                    upsertHit({
                        file_id: fid,
                        score,
                        properties: obj.properties as Record<string, unknown>,
                        matched_chunk: String((obj.properties as { chunk_text?: string }).chunk_text ?? "") || undefined,
                    });
                }
            }

            // 2) Filename match against the summary collection — preserve the old UX.
            if (await client.collections.exists(summaryName)) {
                const sumCol = client.collections.get<SmartDriveSchema>(summaryName);
                const filenameHits = await sumCol.query.fetchObjects({
                    limit: 5,
                    filters: Filters.and(
                        sumCol.filter.byProperty("user_id").equal(userId),
                        sumCol.filter.byProperty("filename").like(`*${userQuery}*`),
                    ),
                });
                for (const obj of filenameHits.objects) {
                    const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                    if (!fid) continue;
                    upsertHit({
                        file_id: fid,
                        score: 0.85,
                        properties: obj.properties as Record<string, unknown>,
                    });
                }

                // 3) High-precision entity/date/doc_id filter against the summary collection.
                // Files where ALL provided signals match get a strong boost; partial
                // matches still get a smaller bump so they bubble up in the ranking.
                if (hasEntitySignals) {
                    const sumCol2 = client.collections.get<SmartDriveSchema>(summaryName);
                    const orParts = [];
                    if (qe!.entities.length) orParts.push(sumCol2.filter.byProperty("entities").containsAny(qe!.entities));
                    if (qe!.dates.length) orParts.push(sumCol2.filter.byProperty("dates").containsAny(qe!.dates));
                    if (qe!.doc_ids.length) orParts.push(sumCol2.filter.byProperty("doc_ids").containsAny(qe!.doc_ids));
                    if (qe!.topics.length) orParts.push(sumCol2.filter.byProperty("topics").containsAny(qe!.topics));
                    if (orParts.length) {
                        try {
                            const entityHits = await sumCol2.query.fetchObjects({
                                limit: 30,
                                filters: Filters.and(
                                    sumCol2.filter.byProperty("user_id").equal(userId),
                                    Filters.or(...orParts),
                                ),
                            });
                            for (const obj of entityHits.objects) {
                                const props = obj.properties as {
                                    file_id?: string;
                                    entities?: string[]; dates?: string[]; doc_ids?: string[]; topics?: string[];
                                };
                                const fid = String(props.file_id ?? "");
                                if (!fid) continue;
                                const matched_entities = qe!.entities.filter((e) => (props.entities ?? []).includes(e));
                                const matched_dates = qe!.dates.filter((d) => (props.dates ?? []).includes(d));
                                const matched_doc_ids = qe!.doc_ids.filter((d) => (props.doc_ids ?? []).includes(d));
                                const matched_topics = qe!.topics.filter((t) => (props.topics ?? []).includes(t));
                                const requested = qe!.entities.length + qe!.dates.length + qe!.doc_ids.length + qe!.topics.length;
                                const matched = matched_entities.length + matched_dates.length + matched_doc_ids.length + matched_topics.length;
                                // 0.6 base + up to 0.4 for fully matching all requested signals.
                                const score = 0.6 + 0.4 * (matched / Math.max(1, requested));
                                upsertHit({
                                    file_id: fid,
                                    score,
                                    properties: obj.properties as Record<string, unknown>,
                                    matched_entities: matched_entities.length ? matched_entities : undefined,
                                    matched_dates: matched_dates.length ? matched_dates : undefined,
                                    matched_doc_ids: matched_doc_ids.length ? matched_doc_ids : undefined,
                                });
                            }
                        } catch (err) {
                            // Older collections may not have the array fields yet — that's fine.
                            logger.warn(`Entity-filter pass failed on ${summaryName}: ${err}`);
                        }
                    }
                }
            }
        }

        // 3) For results that came from chunks, fetch the parent summary row so
        //    the UI gets summary/filename/filetype/created_at consistently.
        const fileIds = Array.from(bestByFile.keys());
        if (fileIds.length === 0) {
            logger.info(`queryWeaviate: 0 results for "${userQuery}"`);
            return [];
        }

        const summariesByFile = new Map<string, Record<string, unknown>>();
        for (const { summary: summaryName } of pairs) {
            if (!(await client.collections.exists(summaryName))) continue;
            const sumCol = client.collections.get<SmartDriveSchema>(summaryName);
            const res = await sumCol.query.fetchObjects({
                limit: fileIds.length,
                filters: Filters.and(
                    sumCol.filter.byProperty("user_id").equal(userId),
                    sumCol.filter.byProperty("file_id").containsAny(fileIds),
                ),
            });
            for (const obj of res.objects) {
                const fid = String((obj.properties as { file_id?: string }).file_id ?? "");
                if (fid && !summariesByFile.has(fid)) {
                    summariesByFile.set(fid, obj.properties as Record<string, unknown>);
                }
            }
        }

        const merged = fileIds
            .map((fid) => {
                const hit = bestByFile.get(fid)!;
                const parent = summariesByFile.get(fid) ?? hit.properties;
                return {
                    ...parent,
                    file_id: fid,
                    score: hit.score,
                    matched_chunk: hit.matched_chunk,
                    matched_entities: hit.matched_entities,
                    matched_dates: hit.matched_dates,
                    matched_doc_ids: hit.matched_doc_ids,
                };
            })
            .sort((a, b) => (b.score as number) - (a.score as number));

        logger.info(`queryWeaviate: ${merged.length} unique files for "${userQuery}"`);
        return merged;
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
