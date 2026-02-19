import logger from '../logger.js';

import { GoogleGenAI } from '@google/genai';

// 1. Initialize the Client with your API Key
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const generateQueryEmbedding = async (query: string) => {
    try {

        const response = await genai.models.embedContent({
            model: 'gemini-embedding-001', // The current stable standard
            contents: query,             // Pass the string directly
            config: {
                taskType: 'RETRIEVAL_QUERY',
                outputDimensionality: 768
            }
        });

        // 3. Access the embedding values from the response
        // result.embeddings is an array; the first element contains your values
        const embedding = response.embeddings;

        if (!embedding || embedding.length === 0 || !embedding[0].values) {
            logger.error('API call succeeded but returned no embedding values.');
            throw new Error('Embedding generation resulted in empty values.');
        }

        logger.info('Generated embedding successfully');

        return embedding[0].values;
    } catch (error) {
        logger.error('Failed to generate query embedding:', error);
        throw new Error('Could not generate embedding for query.');
    }
};

export default generateQueryEmbedding;