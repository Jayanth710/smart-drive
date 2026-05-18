import { Request, Response } from "express";
import multer from "multer";
import { AuthenticatedRequest } from "../middleware/auth.js";
import logger from "../logger.js";
import { quickExtract } from "../services/quickExtract.js";
import { chunkMarkdown } from "../services/chunking.js";
import { embedBatch } from "../services/gemini.js";
import { redactBatch } from "../services/redact.js";
import {
    createSession, getSession, deleteSession, EphemeralChunk,
} from "../services/ephemeralChatStore.js";
import { runEphemeralChat, runEphemeralChatStream } from "../services/ephemeralChatPipeline.js";
import type { ChatTurn } from "../services/chatPipeline.js";

// Memory storage — file never touches disk.
export const ephemeralUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
});

export const uploadEphemeralFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id?.toString();
    if (!userId) { res.status(401).json({ message: "Not authorised." }); return; }
    const file = req.file;
    if (!file) { res.status(400).json({ message: "No file uploaded." }); return; }

    try {
        const extracted = await quickExtract(file.buffer, file.originalname, file.mimetype);
        // Markdown-aware chunker with parent/child + table flag.
        const chunks = chunkMarkdown(extracted.text, {
            childTargetTokens: 400, parentTargetTokens: 1500, overlapTokens: 60,
        });
        if (chunks.length === 0) {
            res.status(400).json({ message: "File parsed but contained no usable text." });
            return;
        }

        // PII redaction on embedding inputs only; original text retained for display.
        const { redactedTexts, totalRedactions } = redactBatch(chunks.map((c) => c.text));
        if (totalRedactions > 0) {
            logger.info(`ephemeral upload: redacted ${totalRedactions} PII spans pre-embedding`);
        }

        const vectors = await embedBatch(redactedTexts);
        const ephemeral: EphemeralChunk[] = chunks
            .map((c, i) => ({
                index: c.index,
                text: c.text,
                parent_text: c.parent_text,
                parent_index: c.parent_index,
                has_table: c.has_table,
                vector: vectors[i] ?? [],
            }))
            .filter((c) => c.vector.length > 0);
        if (ephemeral.length === 0) {
            res.status(502).json({ message: "Could not embed any chunks. Please retry." });
            return;
        }

        const sess = createSession(userId, file.originalname, file.mimetype, extracted.text, ephemeral);
        logger.info(`ephemeral-chat: created session ${sess.id} for userId=${userId} (${ephemeral.length} chunks, ${totalRedactions} redactions)`);
        res.status(201).json({
            session_id: sess.id,
            filename: sess.filename,
            chunk_count: ephemeral.length,
            redactions: totalRedactions,
            detected_kind: extracted.detectedKind,
        });
    } catch (err) {
        const msg = (err as Error).message || "Could not process file.";
        logger.warn(`ephemeral-chat upload failed: ${msg}`);
        res.status(400).json({ message: msg });
    }
};

export const ephemeralChat = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id?.toString();
    const { sessionId } = req.params;
    const { message, history } = req.body as { message?: string; history?: ChatTurn[] };

    if (!userId) { res.status(401).json({ message: "Not authorised." }); return; }
    if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ message: "A non-empty message is required." });
        return;
    }
    if (message.length > 2000) {
        res.status(400).json({ message: "Message too long (max 2000 chars)." });
        return;
    }

    const sess = getSession(sessionId, userId);
    if (!sess) {
        res.status(404).json({ message: "Session not found or expired. Re-upload to start a new chat." });
        return;
    }

    const validHistory: ChatTurn[] = Array.isArray(history)
        ? history.filter((t): t is ChatTurn =>
            t != null && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
        )
        : [];

    try {
        const result = await runEphemeralChat({
            filename: sess.filename, chunks: sess.chunks,
            history: validHistory, message: message.trim(),
        });
        res.status(200).json(result);
    } catch (err) {
        logger.error(`ephemeral chat error for session=${sessionId}: ${err}`);
        res.status(500).json({ message: "Chat failed. Please retry." });
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
    // @ts-expect-error optional flush
    res.flush?.();
};

export const ephemeralChatStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id?.toString();
    const { sessionId } = req.params;
    const { message, history } = req.body as { message?: string; history?: ChatTurn[] };

    if (!userId || !message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ message: "Bad request." }); return;
    }
    if (message.length > 2000) {
        res.status(400).json({ message: "Message too long." }); return;
    }
    const sess = getSession(sessionId, userId);
    if (!sess) {
        res.status(404).json({ message: "Session not found or expired." }); return;
    }

    const validHistory: ChatTurn[] = Array.isArray(history)
        ? history.filter((t): t is ChatTurn =>
            t != null && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
        )
        : [];

    sseHeaders(res);
    try {
        for await (const event of runEphemeralChatStream({
            filename: sess.filename, chunks: sess.chunks,
            history: validHistory, message: message.trim(),
        })) {
            sseWrite(res, event.type, event);
        }
        res.end();
    } catch (err) {
        logger.error(`ephemeral stream error session=${sessionId}: ${err}`);
        sseWrite(res, "error", { message: "Stream failed." });
        res.end();
    }
};

export const getEphemeralSessionText = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id?.toString();
    const { sessionId } = req.params;
    if (!userId) { res.status(401).json({ message: "Not authorised." }); return; }
    const sess = getSession(sessionId, userId);
    if (!sess) {
        res.status(404).json({ message: "Session not found or expired." });
        return;
    }
    // Cap response so very long files don't ship megabytes to the browser.
    const MAX = 200_000; // ~200 KB
    const truncated = sess.rawText.length > MAX;
    res.status(200).json({
        filename: sess.filename,
        filetype: sess.filetype,
        text: truncated ? sess.rawText.slice(0, MAX) : sess.rawText,
        truncated,
        full_length: sess.rawText.length,
    });
};

export const closeEphemeralSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id?.toString();
    const { sessionId } = req.params;
    if (!userId) { res.status(401).json({ message: "Not authorised." }); return; }
    const ok = deleteSession(sessionId, userId);
    res.status(200).json({ closed: ok });
};

export const ephemeralRequestHandler = (handler: (req: AuthenticatedRequest, res: Response) => Promise<void>) =>
    (req: Request, res: Response) => handler(req as AuthenticatedRequest, res);
