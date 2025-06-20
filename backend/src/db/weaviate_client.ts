import weaviate from 'weaviate-client'
import logger from '../logger.js';

const WEAVIATE_URL = process.env.WEAVIATE_URL as string;
const WEAVIATE_API_KEY = process.env.WEAVIATE_API_KEY as string;

const getWeaviateClient = async () => {

    if (!WEAVIATE_URL || !WEAVIATE_API_KEY) {
        logger.error("WEAVIATE_CLUSTER_URL or WEAVIATE_API_KEY environment variables not set.")
        return;
    }
    try {
        const client = await weaviate.connectToWeaviateCloud(
            WEAVIATE_URL, {
            authCredentials: new weaviate.ApiKey(WEAVIATE_API_KEY),
        }
        )
        logger.info("Successfully connected to Weaviate.")

        return client
    }
    catch (e) {
        logger.error(`Failed to connect to Weaviate: ${e}`)
        return
    }
}

export default getWeaviateClient;