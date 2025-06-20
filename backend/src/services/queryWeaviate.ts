import getWeaviateClient from "../db/weaviate_client.js";
import logger from "../logger.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";

const queryWeaviate = async (userQuery: string) => {

    try {
        const client = await getWeaviateClient();
        if (client) {
            const myCollection = client.collections.get('SmartDriveSummary');

            const queryVector = await generateQueryEmbedding(userQuery)

            const hybridQuery = await myCollection.query.hybrid(
                userQuery,
                {
                    vector: queryVector,
                    alpha: 0.5,
                    limit: 3,
                    // filters: myCollection.filter.byProperty("fileName").like(`*${userQuery}`),
                    returnMetadata: ['score']
                }
            );
            return hybridQuery;
        }
    } catch (error) {
        logger.error('An error occurred during the search operation:', error);
        return { status: 500, error: 'Search failed due to an internal error.' };
    }

}

export default queryWeaviate;