import getWeaviateClient from "../db/weaviate_client.js";
import { Filters } from 'weaviate-client';
import logger from "../logger.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";
import { runSearchPipeline } from "./searchPipeline.js";

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

const queryWeaviate = async (userId: string, userQuery: string, queryCollection: string) => {
    try {
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

        return await runSearchPipeline(userId, userQuery, pairs);
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
