import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import logger from '../logger.js';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const generateQueryEmbedding = async (query: string) => {
    try {

        const model = genAI.getGenerativeModel({ model: "models/gemini-embedding-001" });
        const result = await model.embedContent({
            content: {
                parts: [{ text: query }],
                role: "user"
            },
            taskType: TaskType.RETRIEVAL_QUERY,
        });

        const embedding = result.embedding;

        if (!embedding || !embedding.values) {
            logger.error('API call succeeded but returned no embedding values.');
            throw new Error('Embedding generation resulted in empty values.');
        }

        logger.info('Generated embedding successfully');

        return embedding.values;
    } catch (error) {
        logger.error('Failed to generate query embedding:', error);
        throw new Error('Could not generate embedding for query.');
    }
};

export default generateQueryEmbedding;