import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import UserFile, { UserFileType } from "../models/userFileModel.js";
import logger from "../logger.js";
import { GetSignedUrlConfig } from "@google-cloud/storage";
import { bucket } from "../services/gcsUpload.js";
import { deleteWeaviateFile, getFileRawText } from "../services/queryWeaviate.js";
import { publishFileMetadata } from "../utils/pubsub.js";
import { prepareFileForChat, wipeChunksForFile } from "../services/chatPreparation.js";
import { runChatPipeline, runChatPipelineStream, ChatTurn } from "../services/chatPipeline.js";
import { recordChatUsage } from "../services/chatUsage.js";

const HISTORY_TURN_CAP = 20;
const STREAM_IDLE_TIMEOUT_MS = 90_000;

const capHistory = (history: ChatTurn[] | undefined): ChatTurn[] => {
    if (!Array.isArray(history)) return [];
    const valid = history.filter((t): t is ChatTurn =>
        t != null && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string',
    );
    return valid.slice(-HISTORY_TURN_CAP);
};

const getUserFile = (fileRecord: UserFileType | null) => {
    const filePath = `${fileRecord?.userId}/${fileRecord?.fileHash}`;
    return bucket.file(filePath);
};

const fileExistsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { hash } = req.query;

    try {
        const userId = req.user?._id.toString();
        const fileExists = await UserFile.findOne({ userId: userId, fileHash: hash })

        if (fileExists) {
            res.status(200).send({ message: "File exists" });
            return;
        }
        res.status(404).send({ message: "File does not exist" });
        return;
    } catch (error) {
        logger.error(error)
        res.status(500).send({ message: "Internal server error" });
        return;
    }

}

const generateFileSignedUrl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params
    const { action } = req.query

    if (!userId) {
        res.status(401).json({ message: 'User not found' })
        return
    };
    if (!fileId) {
        res.status(400).json({ message: 'File name is required' })
        return
    };

    try {

        const fileRecord = await UserFile.findById(fileId);

        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            logger.warn(`User ${userId} attempted to access unauthorized file ${fileId}`);
            res.status(403).json({ message: "Forbidden: You do not have access to this file." });
            return
        }

        const file = getUserFile(fileRecord);

        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).json({ message: 'File not found' });
            return
        }

        const options: GetSignedUrlConfig = {
            version: 'v4',
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000,
        };

        if (action === 'download') {
            options.responseDisposition = `attachment; filename="${fileRecord?.fileName}"`;
        }

        const [url] = await file.getSignedUrl(options);
        res.status(200).json({ url });
        return

    } catch (error) {
        logger.error(`Failed to generate signed URL for ${fileId}:`, error);
        res.status(500).json({ message: 'Could not generate file URL.' });
        return
    }


}

const deleteFile = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params

    if (!userId) {
        res.status(401).json({ message: 'User not found' });
        return
    }
    if (!fileId) {
        res.status(400).json({ message: 'File name is required' });
        return
    }

    try {
        const fileRecord = await UserFile.findById(fileId);

        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            logger.warn(`User ${userId} attempted to access unauthorized file ${fileId}`);
            res.status(403).json({ message: "Forbidden: You do not have access to this file." });
            return
        }

        let targetCollection: string;
        const mainFileType = fileRecord?.fileType.split('/')[0];

        if (mainFileType === 'image') {
            targetCollection = 'SmartDriveImages';
        } else if (mainFileType === 'audio' || mainFileType === 'video') {
            targetCollection = 'SmartDriveMedia';
        } else {
            targetCollection = 'SmartDriveDocuments';
        }

        const file = getUserFile(fileRecord);

        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).json({ message: 'File not found' });
            return
        }

        const [gcsResult, weaviateSuccess] = await Promise.all([
            file.delete().then(() => true).catch((err: unknown) => {
                logger.error(`GCS delete failed for fileId ${fileId}:`, err);
                return false;
            }),
            deleteWeaviateFile(userId!, fileRecord?._id.toString(), targetCollection)
        ]);

        if (!gcsResult || !weaviateSuccess) {
            throw new Error(`Failed to delete file assets for fileId: ${fileId} (gcs=${gcsResult}, weaviate=${weaviateSuccess})`);
        }
        await UserFile.findByIdAndDelete(fileId)

        logger.info(`Successfully deleted ${fileRecord?.fileName}`)
        res.status(200).send({ message: `Successfully deleted ${fileRecord?.fileName}` })
        return
    } catch (error: unknown) {
        logger.error(`Deletion failed for fileId ${fileId}:`, error);
        res.status(500).json({ error: 'Deletion failed due to an internal error.' });
        return
    }
}

const triggerExtraction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;

    if (!userId) {
        res.status(401).json({ message: 'User not found' });
        return;
    }
    if (!fileId) {
        res.status(400).json({ message: 'File id is required' });
        return;
    }

    try {
        const fileRecord = await UserFile.findById(fileId);
        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            logger.warn(`User ${userId} attempted to trigger extraction on unauthorized file ${fileId}`);
            res.status(403).json({ message: 'Forbidden: You do not have access to this file.' });
            return;
        }

        // Don't double-queue a file that's already mid-flight. The worker
        // dedups against Weaviate too, but we save a round-trip here.
        if (fileRecord.extractionStatus === 'processing') {
            res.status(409).json({ message: 'Extraction already in progress.' });
            return;
        }

        // Hard guard: a private file must NEVER be sent to the worker for
        // LLM extraction. The worker should also check isPrivate and write a
        // stub, but a stale worker deploy could ignore the flag — so refuse
        // here as well. Re-extraction of a private file is a no-op; the
        // filename stub is already indexed.
        if (fileRecord.isPrivate) {
            logger.info(`triggerExtraction skipped for private fileId=${fileId} — already indexed as stub`);
            fileRecord.extractionStatus = 'done';
            fileRecord.extractionError = undefined;
            fileRecord.chatReady = false;
            await fileRecord.save();
            res.status(200).json({
                message: 'File is marked private — re-extraction would send contents to AI and is blocked. Toggle privacy off first.',
                extraction_status: 'done',
            });
            return;
        }

        // Reset state so the UI immediately reflects "queued" — even before
        // the worker picks the message up. Also flush the cached chat index:
        // a re-extracted file should be chunked from the new text, not the old.
        fileRecord.extractionStatus = 'pending';
        fileRecord.extractionError = undefined;
        fileRecord.chatReady = false;
        await fileRecord.save();
        // Best-effort: wipe per-chunk vectors so the next chat re-prepares them.
        wipeChunksForFile(userId, fileId).catch((err) =>
            logger.warn(`wipeChunksForFile during re-extract failed: ${err}`),
        );

        try {
            await publishFileMetadata(fileRecord);
        } catch (pubsubErr) {
            logger.error(`Re-publish failed for fileId ${fileId}:`, pubsubErr);
            await UserFile.findByIdAndUpdate(fileId, {
                extractionStatus: 'failed',
                extractionError: 'Failed to enqueue extraction job',
            });
            res.status(502).json({ message: 'Could not enqueue the file for extraction.' });
            return;
        }

        logger.info(`Re-queued extraction for fileId ${fileId}`);
        res.status(202).json({
            message: 'Extraction queued.',
            extraction_status: 'pending',
        });
        return;
    } catch (error) {
        logger.error(`triggerExtraction failed for fileId ${fileId}:`, error);
        res.status(500).json({ error: 'Could not trigger extraction.' });
        return;
    }
};

const prepareChat = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;
    if (!userId || !fileId) {
        res.status(400).json({ message: 'Missing user or file id.' });
        return;
    }
    try {
        const file = await UserFile.findById(fileId);
        if (file && file.userId.toString() === userId && file.isPrivate) {
            res.status(403).json({
                message: 'Chat is disabled for private files. Toggle privacy off to enable AI features.',
            });
            return;
        }
        const result = await prepareFileForChat(userId, fileId);
        if (!result.ready) {
            res.status(409).json({ message: result.reason });
            return;
        }
        res.status(200).json(result);
    } catch (err) {
        logger.error(`prepareChat failed for fileId=${fileId}:`, err);
        res.status(500).json({ message: 'Could not prepare chat.' });
    }
};

const togglePrivacy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;
    const { isPrivate } = req.body as { isPrivate?: boolean };

    if (!userId || !fileId) {
        res.status(400).json({ message: 'Missing user or file id.' });
        return;
    }
    if (typeof isPrivate !== 'boolean') {
        res.status(400).json({ message: 'isPrivate (boolean) is required.' });
        return;
    }

    try {
        const file = await UserFile.findById(fileId);
        if (!file || file.userId.toString() !== userId) {
            res.status(403).json({ message: 'Forbidden.' });
            return;
        }
        if (file.isPrivate === isPrivate) {
            res.status(200).json({ isPrivate, changed: false });
            return;
        }

        // Wipe existing index rows + any cached chunks, then re-queue extraction
        // so the worker re-runs with the new privacy mode (skips LLM if private).
        const summaryCol = file.fileType?.startsWith('image/')
            ? 'SmartDriveImages'
            : file.fileType?.startsWith('video/') || file.fileType?.startsWith('audio/')
                ? 'SmartDriveMedia'
                : 'SmartDriveDocuments';
        await deleteWeaviateFile(userId, fileId, summaryCol);
        await wipeChunksForFile(userId, fileId);

        file.isPrivate = isPrivate;
        file.extractionStatus = 'pending';
        file.chatReady = false;
        await file.save();

        await publishFileMetadata(file);

        res.status(200).json({ isPrivate, changed: true });
    } catch (err) {
        logger.error(`togglePrivacy failed for fileId=${fileId}:`, err);
        res.status(500).json({ message: 'Could not update privacy.' });
    }
};

const chatWithFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;
    const { message, history } = req.body as { message?: string; history?: ChatTurn[] };

    if (!userId) {
        res.status(401).json({ message: 'User not found' });
        return;
    }
    if (!fileId) {
        res.status(400).json({ message: 'File id is required' });
        return;
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ message: 'A non-empty message is required.' });
        return;
    }
    if (message.length > 2000) {
        res.status(400).json({ message: 'Message too long (max 2000 chars).' });
        return;
    }

    try {
        const fileRecord = await UserFile.findById(fileId);
        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            res.status(403).json({ message: 'Forbidden: You do not have access to this file.' });
            return;
        }
        if (fileRecord.isPrivate) {
            res.status(403).json({ message: 'Chat is disabled for private files.' });
            return;
        }
        if (fileRecord.extractionStatus !== 'done') {
            res.status(409).json({
                message: 'This file is not ready for chat yet. Wait for extraction to finish.',
                extraction_status: fileRecord.extractionStatus,
            });
            return;
        }

        // Lazy chat prep: chunk + embed on the first chat for a file.
        // Idempotent + cached after the first run via the `chatReady` Mongo flag.
        const prep = await prepareFileForChat(userId, fileId);
        if (!prep.ready) {
            res.status(409).json({ message: prep.reason });
            return;
        }

        const validHistory: ChatTurn[] = capHistory(history);

        recordChatUsage(userId, "persistent");
        const result = await runChatPipeline({
            userId,
            fileId,
            filename: fileRecord.fileName,
            history: validHistory,
            message: message.trim(),
        });

        res.status(200).json({
            answer: result.answer,
            sources: result.sources,
            confidence: result.confidence,
            refused: result.refused,
            out_of_scope: result.out_of_scope,
            rewritten_query: result.rewritten_query,
            // Surface that this was the cold-start chat so the UI can tell users why
            // the very first message took a few seconds.
            prepared_now: !prep.cached,
        });
    } catch (error) {
        logger.error(`chatWithFile failed for fileId=${fileId}:`, error);
        res.status(500).json({ message: 'Could not chat with file.' });
    }
};

const sseHeaders = (res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
};

const sseWrite = (res: Response, event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // @ts-expect-error - flush is provided by compression / Express in dev; safe to ignore if absent.
    res.flush?.();
};

const chatWithFileStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;
    const { message, history } = req.body as { message?: string; history?: ChatTurn[] };

    if (!userId || !fileId || !message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ message: 'Bad request.' });
        return;
    }
    if (message.length > 2000) {
        res.status(400).json({ message: 'Message too long.' });
        return;
    }

    try {
        const fileRecord = await UserFile.findById(fileId);
        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            res.status(403).json({ message: 'Forbidden.' });
            return;
        }
        if (fileRecord.isPrivate) {
            res.status(403).json({ message: 'Chat is disabled for private files.' });
            return;
        }
        if (fileRecord.extractionStatus !== 'done') {
            res.status(409).json({ message: 'Not ready for chat yet.' });
            return;
        }

        const prep = await prepareFileForChat(userId, fileId);
        if (!prep.ready) {
            res.status(409).json({ message: prep.reason });
            return;
        }

        sseHeaders(res);
        sseWrite(res, "ready", { prepared_now: !prep.cached, redactions: prep.redactions ?? 0 });

        const validHistory: ChatTurn[] = capHistory(history);
        recordChatUsage(userId, "persistent");

        // Idle-stream guard: if nothing arrives from the pipeline for 90s,
        // close the SSE connection so the client doesn't hang.
        let lastActivity = Date.now();
        const idleTimer = setInterval(() => {
            if (Date.now() - lastActivity > STREAM_IDLE_TIMEOUT_MS) {
                clearInterval(idleTimer);
                try { sseWrite(res, "error", { message: "Response timed out." }); res.end(); } catch { /* socket already closed */ }
            }
        }, 10_000);
        req.on("close", () => clearInterval(idleTimer));

        try {
            for await (const event of runChatPipelineStream({
                userId, fileId, filename: fileRecord.fileName,
                history: validHistory, message: message.trim(),
            })) {
                lastActivity = Date.now();
                sseWrite(res, event.type, event);
            }
        } finally {
            clearInterval(idleTimer);
        }
        res.end();
    } catch (err) {
        logger.error(`chatWithFileStream failed for fileId=${fileId}:`, err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Stream failed.' });
        } else {
            sseWrite(res, "error", { message: 'Stream failed mid-response.' });
            res.end();
        }
    }
};

const getFileText = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params;
    if (!userId || !fileId) {
        res.status(400).json({ message: 'Missing user or file id.' });
        return;
    }
    try {
        const file = await UserFile.findById(fileId);
        if (!file || file.userId.toString() !== userId) {
            res.status(403).json({ message: 'Forbidden.' });
            return;
        }
        if (file.extractionStatus !== 'done') {
            res.status(409).json({ message: 'Extraction not finished yet.' });
            return;
        }
        const text = await getFileRawText(userId, fileId);
        const MAX_PREVIEW = 200_000;
        const trimmed = text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW) : text;
        res.status(200).json({ text: trimmed, truncated: text.length > MAX_PREVIEW, length: text.length });
    } catch (err) {
        logger.error(`getFileText failed for fileId=${fileId}:`, err);
        res.status(500).json({ message: 'Could not load extracted text.' });
    }
};

export {
    fileExistsHandler,
    generateFileSignedUrl,
    deleteFile,
    triggerExtraction,
    chatWithFile,
    chatWithFileStream,
    prepareChat,
    getFileText,
    togglePrivacy,
}

