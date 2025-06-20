import { Request, Response } from "express";
import logger from "../logger.js";
import queryWeaviate from "../services/queryWeaviate.js";

const queryHandler = async (req: Request, res: Response): Promise<void> => {
    const userQuery = req.body.query as string;

    if (!userQuery) {
        res.status(400).json({ error: 'Search query "q" is required.' });
    }

    try {
        const response = await queryWeaviate(userQuery)
        res.status(200).json(response);
    }
    catch (error) {
        logger.error('An error occurred during the search operation:', error);
        res.status(500).json({ error: 'Search failed due to an internal error.' });
    }

}

export default queryHandler;