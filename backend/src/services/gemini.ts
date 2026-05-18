import { GoogleGenAI } from '@google/genai';
import logger from '../logger.js';
import { withRetry } from './retry.js';

let _client: GoogleGenAI | null = null;
const client = (): GoogleGenAI => {
    if (!_client) _client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    return _client;
};

const TEXT_MODEL = () => process.env.LLM_MODEL || 'gemini-2.5-flash';
const EMBED_MODEL = () => process.env.EMBEDDING_MODEL || 'gemini-embedding-001';

/**
 * Plain text generation with retry.
 */
export const geminiText = async (prompt: string, maxOutputTokens = 1024): Promise<string> => {
    return withRetry(async () => {
        const res = await client().models.generateContent({
            model: TEXT_MODEL(),
            contents: prompt,
            config: { temperature: 0.3, maxOutputTokens },
        });
        return (res.text ?? '').trim();
    }, { label: 'geminiText' });
};

/**
 * JSON-schema-enforced generation. Returns the parsed object (or null on parse failure).
 *
 * Empty / truncated responses log a clear warning with the call label so we
 * can tell which pipeline step degraded (rewrite vs rerank vs multi-query).
 */
export const geminiJSON = async <T = unknown>(
    prompt: string,
    schema: Record<string, unknown>,
    maxOutputTokens = 1024,
    label = 'geminiJSON',
): Promise<T | null> => {
    return withRetry(async () => {
        const res = await client().models.generateContent({
            model: TEXT_MODEL(),
            contents: prompt,
            config: {
                temperature: 0,
                maxOutputTokens,
                responseMimeType: 'application/json',
                responseSchema: schema,
            },
        });
        const raw = (res.text ?? '').trim();
        if (!raw) {
            // Quietly: empty response is usually a rate-limit or a model output
            // hitting maxOutputTokens before a complete JSON.
            logger.warn(`${label}: model returned empty text (rate-limited or truncated)`);
            return null;
        }
        try {
            return JSON.parse(raw) as T;
        } catch (e) {
            logger.warn(`${label}: parse failed (${(e as Error).message}); raw length=${raw.length}, head=${JSON.stringify(raw.slice(0, 80))}`);
            return null;
        }
    }, { label });
};

/**
 * Batched embeddings — one API call for many texts. Returns vectors aligned to
 * input order; failed slots are null so callers can skip them rather than index
 * zero vectors.
 */
export const embedBatch = async (texts: string[]): Promise<(number[] | null)[]> => {
    const cleaned = texts.filter((t) => typeof t === 'string' && t.trim());
    if (cleaned.length === 0) return [];
    try {
        return await withRetry(async () => {
            const res = await client().models.embedContent({
                model: EMBED_MODEL(),
                contents: cleaned,
                config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
            });
            const embeds = res.embeddings ?? [];
            const out: (number[] | null)[] = embeds.map((e) => e.values ?? null);
            while (out.length < cleaned.length) out.push(null);
            return out;
        }, { label: 'embedBatch' });
    } catch (e) {
        logger.error(`embedBatch failed for ${cleaned.length} items: ${e}`);
        return cleaned.map(() => null);
    }
};

export const embedSingle = async (text: string): Promise<number[] | null> => {
    const [v] = await embedBatch([text]);
    return v ?? null;
};

/**
 * Stream Gemini text generation. Yields each text delta as it arrives.
 *
 * Retry covers the INITIAL request setup (rate-limit 429, transient 5xx).
 * Once the stream is actually producing tokens we don't retry — replaying
 * would risk delivering partial or duplicated text to the client.
 */
export const geminiTextStream = async function* (
    prompt: string,
    maxOutputTokens = 1024,
): AsyncGenerator<string, void, void> {
    const stream = await withRetry(
        () => client().models.generateContentStream({
            model: TEXT_MODEL(),
            contents: prompt,
            config: { temperature: 0.3, maxOutputTokens },
        }),
        { label: 'geminiTextStream:open' },
    );
    for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
        const text = chunk?.text;
        if (text) yield text;
    }
};
