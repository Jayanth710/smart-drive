import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import UserFile, { UserFileType } from "../models/userFileModel.js";
import logger from "../logger.js";
import { GetSignedUrlConfig } from "@google-cloud/storage";
import { bucket } from "../services/gcsUpload.js";
import { deleteWeaviateFile } from "../services/queryWeaviate.js";
import { publishFileMetadata } from "../utils/pubsub.js";
import { prepareFileForChat, wipeChunksForFile } from "../services/chatPreparation.js";
import { runChatPipeline, runChatPipelineStream, ChatTurn } from "../services/chatPipeline.js";

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

        const validHistory: ChatTurn[] = Array.isArray(history)
            ? history.filter((t): t is ChatTurn =>
                t != null && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string',
            )
            : [];

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
        // Tell the client whether this chat is paying the cold-start cost.
        sseWrite(res, "ready", { prepared_now: !prep.cached });

        const validHistory: ChatTurn[] = Array.isArray(history)
            ? history.filter((t): t is ChatTurn =>
                t != null && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string',
            )
            : [];

        for await (const event of runChatPipelineStream({
            userId, fileId, filename: fileRecord.fileName,
            history: validHistory, message: message.trim(),
        })) {
            sseWrite(res, event.type, event);
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

export {
    fileExistsHandler,
    generateFileSignedUrl,
    deleteFile,
    triggerExtraction,
    chatWithFile,
    chatWithFileStream,
    prepareChat,
}

