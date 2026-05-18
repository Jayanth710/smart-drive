/**
 * In-process text extraction for the ephemeral chat flow.
 *
 * Supports a deliberately narrow set of formats — PDF, DOCX, plain text /
 * markdown — because the whole point of this mode is "fast and ephemeral."
 * Heavier formats (audio/video, images requiring OCR) belong in the persistent
 * upload pipeline where docling / Whisper run in the worker.
 */

import logger from "../logger.js";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap for ephemeral mode

export type ExtractResult = {
    text: string;
    detectedKind: "pdf" | "docx" | "text" | "markdown";
};

const truncateForLog = (s: string, n = 100) => (s.length > n ? s.slice(0, n) + "…" : s);

export const quickExtract = async (
    buffer: Buffer,
    filename: string,
    mimetype: string,
): Promise<ExtractResult> => {
    if (buffer.length === 0) throw new Error("File is empty.");
    if (buffer.length > MAX_BYTES) {
        throw new Error(`File too large for ephemeral chat (${Math.round(buffer.length / 1024 / 1024)}MB > 20MB). Upload it through your drive instead.`);
    }

    const lowerName = filename.toLowerCase();
    const lowerMime = (mimetype || "").toLowerCase();

    // PDF
    if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) {
        try {
            // Import the internal module directly. The package's top-level
            // `index.js` runs a self-test that opens a bundled fixture PDF —
            // that fixture isn't shipped in some installs, so it crashes at
            // import time. The internal `lib/pdf-parse.js` is the real parser.
            const mod = await import("pdf-parse/lib/pdf-parse.js");
            const pdfParse = (mod.default ?? mod) as (
                b: Buffer | Uint8Array,
                opts?: Record<string, unknown>,
            ) => Promise<{ text: string }>;
            const result = await pdfParse(buffer);
            const text = (result?.text ?? "").trim();
            if (!text) {
                throw new Error("PDF had no extractable text. It may be image-only — re-upload through your drive for OCR.");
            }
            return { text, detectedKind: "pdf" };
        } catch (err) {
            const raw = (err as Error)?.message ?? String(err);
            logger.error(`quickExtract pdf failed: ${raw}`);
            // Surface the real reason instead of a generic "encrypted or corrupted".
            const lower = raw.toLowerCase();
            if (lower.includes("password") || lower.includes("encrypt")) {
                throw new Error("This PDF is password-protected. Remove the password and try again.");
            }
            if (lower.includes("image-only") || lower.includes("no extractable")) {
                throw new Error(raw);
            }
            throw new Error("Could not parse PDF. The file may be corrupted or use an unsupported feature.");
        }
    }

    // DOCX
    if (
        lowerMime.includes("officedocument.wordprocessingml") ||
        lowerName.endsWith(".docx")
    ) {
        try {
            const mod = await import("mammoth");
            const mammoth = mod.default ?? mod;
            const out = await mammoth.extractRawText({ buffer });
            const text = (out?.value ?? "").trim();
            if (!text) throw new Error("DOCX had no extractable text.");
            return { text, detectedKind: "docx" };
        } catch (err) {
            logger.error(`quickExtract docx failed: ${err}`);
            throw new Error("Could not parse DOCX.");
        }
    }

    // Markdown
    if (lowerMime.includes("markdown") || lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
        return { text: buffer.toString("utf-8").trim(), detectedKind: "markdown" };
    }

    // Plain text (broad acceptance — anything text-like)
    if (lowerMime.startsWith("text/") || /\.(txt|log|csv|json|html|htm|xml|yml|yaml)$/i.test(lowerName)) {
        const text = buffer.toString("utf-8").trim();
        if (!text) throw new Error("File is empty after decoding as text.");
        return { text, detectedKind: "text" };
    }

    logger.warn(`quickExtract: unsupported file ${filename} (${truncateForLog(mimetype)})`);
    throw new Error("Unsupported file type for quick chat. Supported: PDF, DOCX, TXT, MD. Use the regular upload for images, audio, or video.");
};
