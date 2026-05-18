import { GoogleGenAI } from '@google/genai';
import logger from '../logger.js';

/**
 * Pull structured filter signals out of a free-text search query.
 *
 * "Acme Corp Q3 2025 invoice 1234" →
 *   { entities: ["acme corp"], dates: ["q3 2025", "2025"], doc_ids: ["1234"], topics: [...], confidence: 0.85 }
 *
 * Combines a cheap regex pass for dates/IDs with a small Gemini call for
 * entities and topics. Results are cached per-query string so repeated
 * searches don't re-bill the model.
 */

export type QueryEntities = {
    entities: string[];
    dates: string[];
    doc_ids: string[];
    topics: string[];
    confidence: number;
};

const EMPTY: QueryEntities = { entities: [], dates: [], doc_ids: [], topics: [], confidence: 0 };

const QUERY_ENTITY_SCHEMA = {
    type: 'OBJECT',
    properties: {
        entities: {
            type: 'ARRAY',
            description: 'People, companies, organizations, products explicitly named in the query. Lowercase. Singular form. Empty if none.',
            items: { type: 'STRING' },
        },
        topics: {
            type: 'ARRAY',
            description: 'Technical topics, domains, jargon. Lowercase. Empty if none.',
            items: { type: 'STRING' },
        },
    },
    required: ['entities', 'topics'],
};

const CACHE_MAX = 200;
const cache = new Map<string, { value: QueryEntities; at: number }>();

const cacheGet = (key: string): QueryEntities | undefined => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    // Refresh LRU position
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
};

const cacheSet = (key: string, value: QueryEntities) => {
    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
    }
    cache.set(key, { value, at: Date.now() });
};

// --- Cheap deterministic extractors ---

const dedupeLower = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
        const n = v.trim().toLowerCase();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    return out;
};

const extractDatesByRegex = (q: string): string[] => {
    const out: string[] = [];
    // ISO date: 2025-09-12, 2025/09/12
    for (const m of q.matchAll(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) out.push(m[0]);
    // Year alone (1900–2099)
    for (const m of q.matchAll(/\b(19|20)\d{2}\b/g)) out.push(m[0]);
    // Quarter+year: Q3 2025, q3 2025, q3-2025
    for (const m of q.matchAll(/\bq[1-4][\s\-/]?(19|20)\d{2}\b/gi)) out.push(m[0]);
    // Month + year: Jan 2025, January 2025
    for (const m of q.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(19|20)\d{2}\b/gi)) out.push(m[0]);
    // FY: FY2025, FY25
    for (const m of q.matchAll(/\bfy\s?\d{2,4}\b/gi)) out.push(m[0]);
    return dedupeLower(out);
};

const extractDocIdsByRegex = (q: string): string[] => {
    const out: string[] = [];
    // "invoice 1234", "po #5678", "contract C-2025-001", "ticket ABC-123"
    for (const m of q.matchAll(/\b(invoice|po|ticket|contract|order|ref|case)[\s#-]+([a-z0-9\-]{2,})\b/gi)) {
        out.push(m[2]);
    }
    // Bare alphanumeric IDs with a hyphen (e.g. C-2025-001, ABC-123) — but skip pure years.
    for (const m of q.matchAll(/\b([A-Z]{2,}-\d+(?:-[A-Za-z0-9]+)*)\b/g)) {
        out.push(m[1]);
    }
    return dedupeLower(out);
};

// --- LLM-assisted entity/topic pass ---

let _genai: GoogleGenAI | null = null;
const genai = (): GoogleGenAI => {
    if (!_genai) _genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    return _genai;
};

const isInterestingForLLM = (q: string): boolean => {
    // Skip the LLM call for trivial queries — pure noun-phrase keywords like
    // "report" or "design" don't have entities the model can latch onto.
    if (q.length < 8) return false;
    // Require either a capitalised word or at least 3 word tokens.
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) return false;
    if (!/[A-Z][a-z]/.test(q)) return false;
    return true;
};

const askLLMForEntities = async (q: string): Promise<{ entities: string[]; topics: string[] }> => {
    try {
        const response = await genai().models.generateContent({
            model: process.env.LLM_MODEL || 'gemini-2.5-flash',
            contents: `Extract structured search filters from this user search query.

ONLY include entities/topics that appear LITERALLY in the query. Do not invent.
If nothing matches a category, return an empty list.

Query: "${q}"`,
            config: {
                temperature: 0,
                maxOutputTokens: 256,
                responseMimeType: 'application/json',
                responseSchema: QUERY_ENTITY_SCHEMA,
            },
        });
        const raw = response.text;
        if (!raw) return { entities: [], topics: [] };
        const parsed = JSON.parse(raw) as { entities?: unknown; topics?: unknown };
        return {
            entities: dedupeLower(Array.isArray(parsed.entities) ? parsed.entities.filter((x): x is string => typeof x === 'string') : []),
            topics: dedupeLower(Array.isArray(parsed.topics) ? parsed.topics.filter((x): x is string => typeof x === 'string') : []),
        };
    } catch (err) {
        logger.warn(`extractQueryEntities LLM call failed (continuing with regex-only): ${err}`);
        return { entities: [], topics: [] };
    }
};

/**
 * Extract filter signals from a search query. Always returns an object —
 * empty arrays just mean "no filter; fall back to pure hybrid search".
 */
export const extractQueryEntities = async (query: string): Promise<QueryEntities> => {
    const q = query.trim();
    if (!q) return EMPTY;

    const key = q.toLowerCase();
    const cached = cacheGet(key);
    if (cached) return cached;

    const dates = extractDatesByRegex(q);
    const doc_ids = extractDocIdsByRegex(q);

    let entities: string[] = [];
    let topics: string[] = [];
    if (isInterestingForLLM(q)) {
        const llm = await askLLMForEntities(q);
        entities = llm.entities;
        topics = llm.topics;
    }

    const total = entities.length + dates.length + doc_ids.length + topics.length;
    // Confidence heuristic: more matches → higher confidence; cap at 0.95.
    const confidence = Math.min(0.95, 0.3 + 0.2 * total);

    const out: QueryEntities = { entities, dates, doc_ids, topics, confidence };
    cacheSet(key, out);
    return out;
};
