/**
 * Lazy chat preparation: chunks + redacts + embeds + caches per-chunk vectors
 * in Weaviate the first time a user chats with a file.
 *
 * Now produces parent-document chunks (`parent_text` per child + `has_table`)
 * and uses the markdown-aware chunker so structure is preserved.
 *
 * Embeddings are computed on PII-redacted text; the original text is stored
 * for retrieval display and answer-time context.
 */

import { Filters, configure, dataType } from "weaviate-client";
import logger from "../logger.js";
import getWeaviateClient from "../db/weaviate_client.js";
import UserFile from "../models/userFileModel.js";
import { chunkMarkdown, ChildChunk } from "./chunking.js";
import { embedBatch } from "./gemini.js";
import { getFileRawText } from "./queryWeaviate.js";
import { redactBatch } from "./redact.js";

const CHUNK_COLLECTIONS_BY_PARENT: Record<string, string> = {
    SmartDriveDocuments: "SmartDriveDocumentChunks",
    SmartDriveImages: "SmartDriveImageChunks",
    SmartDriveMedia: "SmartDriveMediaChunks",
};
const SUMMARY_COLLECTIONS = Object.keys(CHUNK_COLLECTIONS_BY_PARENT);
const ALL_CHUNK_COLLECTIONS = Object.values(CHUNK_COLLECTIONS_BY_PARENT);

export type ChatPrepResult =
    | { ready: true; cached: boolean; chunks_indexed: number; redactions?: number }
    | { ready: false; reason: string };

const ensureChunkCollection = async (
    client: Awaited<ReturnType<typeof getWeaviateClient>>,
    name: string,
): Promise<void> => {
    if (!client) return;
    if (await client.collections.exists(name)) {
        // Additively migrate older collections that lack parent_text / has_table.
        await ensureNewProperties(client, name);
        return;
    }
    logger.info(`chat-prep: creating chunk collection '${name}'`);
    await client.collections.create({
        name,
        vectorizers: configure.vectorizer.none(),
        properties: [
            { name: "file_id", dataType: dataType.TEXT, indexFilterable: true },
            { name: "user_id", dataType: dataType.TEXT, indexFilterable: true },
            { name: "chunk_index", dataType: dataType.INT },
            { name: "chunk_text", dataType: dataType.TEXT },
            { name: "parent_text", dataType: dataType.TEXT, indexSearchable: false },
            { name: "parent_index", dataType: dataType.INT },
            { name: "has_table", dataType: dataType.BOOLEAN, indexFilterable: true },
            { name: "filename", dataType: dataType.TEXT },
            { name: "filetype", dataType: dataType.TEXT },
            { name: "created_at", dataType: dataType.DATE, indexFilterable: true },
        ],
    });
};

const ensureNewProperties = async (
    client: Awaited<ReturnType<typeof getWeaviateClient>>,
    name: string,
): Promise<void> => {
    if (!client) return;
    try {
        const col = client.collections.get(name);
        const cfg = await col.config.get();
        const existing = new Set((cfg.properties ?? []).map((p) => p.name));
        const wantedAdds: { name: string; dataType: string; opts?: Record<string, unknown> }[] = [
            { name: "parent_text", dataType: dataType.TEXT, opts: { indexSearchable: false } },
            { name: "parent_index", dataType: dataType.INT },
            { name: "has_table", dataType: dataType.BOOLEAN, opts: { indexFilterable: true } },
        ];
        for (const w of wantedAdds) {
            if (existing.has(w.name)) continue;
            try {
                await col.config.addProperty({ name: w.name, dataType: w.dataType, ...(w.opts ?? {}) });
                logger.info(`chat-prep: added property '${w.name}' to '${name}'`);
            } catch (e) {
                logger.warn(`chat-prep: addProperty ${w.name} on ${name} failed: ${e}`);
            }
        }
    } catch (e) {
        logger.warn(`chat-prep: ensureNewProperties on ${name} failed: ${e}`);
    }
};

const findParentRow = async (
    client: Awaited<ReturnType<typeof getWeaviateClient>>,
    userId: string,
    fileId: string,
): Promise<{ collection: string; props: Record<string, unknown> } | null> => {
    if (!client) return null;
    for (const name of SUMMARY_COLLECTIONS) {
        if (!(await client.collections.exists(name))) continue;
        const col = client.collections.get(name);
        const res = await col.query.fetchObjects({
            limit: 1,
            filters: Filters.and(
                col.filter.byProperty("user_id").equal(userId),
                col.filter.byProperty("file_id").equal(fileId),
            ),
        });
        if (res.objects[0]) {
            return { collection: name, props: res.objects[0].properties as Record<string, unknown> };
        }
    }
    return null;
};

const countExistingChunks = async (
    client: Awaited<ReturnType<typeof getWeaviateClient>>,
    chunkCol: string,
    userId: string,
    fileId: string,
): Promise<number> => {
    if (!client) return 0;
    if (!(await client.collections.exists(chunkCol))) return 0;
    const col = client.collections.get(chunkCol);
    const res = await col.query.fetchObjects({
        limit: 1,
        filters: Filters.and(
            col.filter.byProperty("user_id").equal(userId),
            col.filter.byProperty("file_id").equal(fileId),
        ),
    });
    return res.objects.length;
};

/** Hard delete every chunk row for a file. Called on re-extraction. */
export const wipeChunksForFile = async (userId: string, fileId: string): Promise<number> => {
    const client = await getWeaviateClient();
    if (!client) return 0;
    let deleted = 0;
    for (const colName of ALL_CHUNK_COLLECTIONS) {
        if (!(await client.collections.exists(colName))) continue;
        const col = client.collections.get(colName);
        const filters = Filters.and(
            col.filter.byProperty("user_id").equal(userId),
            col.filter.byProperty("file_id").equal(fileId),
        );
        try {
            const res = await col.query.fetchObjects({ limit: 1000, filters });
            for (const obj of res.objects) {
                await col.data.deleteById(obj.uuid);
                deleted++;
            }
        } catch (err) {
            logger.warn(`wipeChunksForFile ${colName} fileId=${fileId} failed: ${err}`);
        }
    }
    if (deleted > 0) logger.info(`wipeChunksForFile: removed ${deleted} chunks for fileId=${fileId}`);
    return deleted;
};

export const prepareFileForChat = async (
    userId: string,
    fileId: string,
): Promise<ChatPrepResult> => {
    const file = await UserFile.findById(fileId);
    if (!file || file.userId.toString() !== userId) {
        return { ready: false, reason: "File not found." };
    }
    if (file.extractionStatus !== "done") {
        return { ready: false, reason: "Extraction has not finished yet." };
    }

    const client = await getWeaviateClient();
    if (!client) return { ready: false, reason: "Search index unavailable." };

    const parent = await findParentRow(client, userId, fileId);
    if (!parent) return { ready: false, reason: "Indexed parent row not found." };

    const chunkCollection = CHUNK_COLLECTIONS_BY_PARENT[parent.collection];
    if (!chunkCollection) return { ready: false, reason: "No chunk collection for this file type." };

    const existing = await countExistingChunks(client, chunkCollection, userId, fileId);
    if (existing > 0) {
        if (!file.chatReady) await UserFile.findByIdAndUpdate(fileId, { chatReady: true });
        return { ready: true, cached: true, chunks_indexed: 0 };
    }

    const rawText = await getFileRawText(userId, fileId);
    if (!rawText || rawText.trim().length === 0) {
        return { ready: false, reason: "No extracted text available to chunk." };
    }

    const chunks: ChildChunk[] = chunkMarkdown(rawText, {
        childTargetTokens: 400,
        parentTargetTokens: 1500,
        overlapTokens: 60,
    });
    if (chunks.length === 0) return { ready: false, reason: "Document is empty after chunking." };

    // PII redaction: applied to embedding input only; original chunk_text stays intact.
    const { redactedTexts, totalRedactions } = redactBatch(chunks.map((c) => c.text));
    if (totalRedactions > 0) {
        logger.info(`chat-prep: redacted ${totalRedactions} PII spans before embedding fileId=${fileId}`);
    }

    logger.info(`chat-prep: embedding ${chunks.length} chunks for fileId=${fileId}`);
    const vectors = await embedBatch(redactedTexts);

    await ensureChunkCollection(client, chunkCollection);
    const col = client.collections.get(chunkCollection);

    const base = {
        file_id: fileId,
        user_id: userId,
        filename: String(parent.props.filename ?? file.fileName ?? ""),
        filetype: String(parent.props.filetype ?? file.fileType ?? ""),
        created_at: (parent.props.created_at as string) ?? new Date().toISOString(),
    };

    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
        const vec = vectors[i];
        if (!vec) continue;
        try {
            await col.data.insert({
                properties: {
                    ...base,
                    chunk_index: chunks[i].index,
                    chunk_text: chunks[i].text,
                    parent_text: chunks[i].parent_text,
                    parent_index: chunks[i].parent_index,
                    has_table: chunks[i].has_table,
                },
                vectors: { default: vec },
            });
            inserted++;
        } catch (err) {
            logger.warn(`chat-prep: insert chunk ${i} failed: ${err}`);
        }
    }

    if (inserted === 0) return { ready: false, reason: "Failed to index any chunks." };

    await UserFile.findByIdAndUpdate(fileId, { chatReady: true });
    logger.info(`chat-prep: fileId=${fileId} ready (${inserted}/${chunks.length} chunks)`);
    return { ready: true, cached: false, chunks_indexed: inserted, redactions: totalRedactions };
};
