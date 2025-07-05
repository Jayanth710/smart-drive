import { Response } from "express";
import logger from "../logger.js";
import { queryWeaviate } from "../services/queryWeaviate.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

const queryHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { userQuery, queryCollection } = req.query;
    logger.info(`${userQuery} ${queryCollection}`)

    if (!userQuery) {
        res.status(400).json({ error: 'Search query "q" is required.' });
        return
    }

    try {
        const userId = req.user?._id.toString();
        logger.info(`${userId} ${userQuery} ${queryCollection}`)
        const response = await queryWeaviate(userId!, userQuery as string, queryCollection as string)
        res.status(200).json(response);
        return
    }
    catch (error) {
        logger.error('An error occurred during the search operation:', error);
        res.status(500).json({ error: 'Search failed due to an internal error.' });
        return
    }

}


export default queryHandler;