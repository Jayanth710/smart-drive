import { Response } from "express";
import logger from "../logger.js";
import { queryWeaviate } from "../services/queryWeaviate.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

const queryHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { userQuery, queryCollection } = req.query;
    logger.info(`${userQuery} ${queryCollection}`)

    if (!userQuery) {
        res.status(400).json({ error: 'Search query "q" is required.' });
    }

    try {
        const userId = req.user?._id.toString();
        logger.info(`${userId} ${userQuery} ${queryCollection}`)
        const response = await queryWeaviate(userId!, userQuery as string, queryCollection as string)
        res.status(200).json(response);
    }
    catch (error) {
        logger.error('An error occurred during the search operation:', error);
        res.status(500).json({ error: 'Search failed due to an internal error.' });
    }

}


export default queryHandler;

// import { Request, Response } from "express";
// import logger from "../logger.js";
// import queryWeaviate from "../services/queryWeaviate.js";
// import getWeaviateClient from "../db/weaviate_client.js";
// import { WeaviateClient } from "weaviate-client";
// import generateQueryEmbedding from "../utils/getQueryEmbedding.js";

// const queryHandler = async (req: Request, res: Response): Promise<void> => {
//     const userQuery = req.body.query as string;

//     if (!userQuery) {
//         res.status(400).json({ error: 'Search query "q" is required.' });
//     }

//     let weaviateClient: WeaviateClient | undefined;

//     try {
//         weaviateClient = await getWeaviateClient();

//         const queryVector = await generateQueryEmbedding(userQuery);

//         const searchPromises = [
//             queryWeaviate(weaviateClient!, userQuery, 'Documents', queryVector),
//             queryWeaviate(weaviateClient!, userQuery, 'Images', queryVector),
//             queryWeaviate(weaviateClient!, userQuery, 'Media', queryVector)
//         ];

//         const resultsFromAllCollections = await Promise.all(searchPromises);

//         const combinedResults = resultsFromAllCollections.flat();

//         combinedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

//         logger.info(`Found a total of ${combinedResults.length} results across all collections.`);

//         res.status(200).json(combinedResults.slice(0, 10));
//     }
//     catch (error) {
//         logger.error('An error occurred during the search operation:', error);
//         res.status(500).json({ error: 'Search failed due to an internal error.' });
//     }

// }

// export default queryHandler;