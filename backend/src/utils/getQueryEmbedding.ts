import logger from '../logger.js';

import { GoogleGenAI } from '@google/genai';

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// ---------- LRU cache for query embeddings ----------
// Real search traffic has 30-50% repeat queries (autosuggest, refinements,
// common search terms). Caching makes the embedding LLM call free on hits.
// Max 500 entries, ~3 MB at 768 floats × 4 bytes × 500 — negligible.

const MAX_CACHE_ENTRIES = 500;
const embeddingCache = new Map<string, number[]>();

const cacheKey = (query: string): string => query.trim().toLowerCase();

const cacheGet = (key: string): number[] | undefined => {
    const hit = embeddingCache.get(key);
    if (!hit) return undefined;
    // LRU: re-insert to mark as most recently used.
    embeddingCache.delete(key);
    embeddingCache.set(key, hit);
    return hit;
};

const cacheSet = (key: string, value: number[]): void => {
    embeddingCache.set(key, value);
    if (embeddingCache.size > MAX_CACHE_ENTRIES) {
        // Evict least-recently-used (first entry in insertion order).
        const oldest = embeddingCache.keys().next().value;
        if (oldest !== undefined) embeddingCache.delete(oldest);
    }
};

const _generateRaw = async (query: string): Promise<number[]> => {
    const response = await genai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: query,
        config: {
            taskType: 'RETRIEVAL_QUERY',
            outputDimensionality: 768,
        },
    });

    const embedding = response.embeddings;
    if (!embedding || embedding.length === 0 || !embedding[0].values) {
        logger.error('API call succeeded but returned no embedding values.');
        throw new Error('Embedding generation resulted in empty values.');
    }
    return embedding[0].values;
};

const generateQueryEmbedding = async (query: string): Promise<number[]> => {
    const key = cacheKey(query);
    if (key) {
        const cached = cacheGet(key);
        if (cached) {
            logger.info(`Embedding cache HIT (size=${embeddingCache.size})`);
            return cached;
        }
    }

    try {
        const vec = await _generateRaw(query);
        if (key) cacheSet(key, vec);
        logger.info(`Embedding cache MISS — generated (size=${embeddingCache.size})`);
        return vec;
    } catch (error) {
        logger.error('Failed to generate query embedding:', error);
        throw new Error('Could not generate embedding for query.');
    }
};

export default generateQueryEmbedding;