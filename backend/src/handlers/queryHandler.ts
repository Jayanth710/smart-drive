import { Response } from "express";
import mongoose from "mongoose";
import logger from "../logger.js";
import { queryWeaviate } from "../services/queryWeaviate.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import SearchClick from "../models/searchClickModel.js";

const queryHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { userQuery, queryCollection } = req.query;
    logger.info(`${userQuery} ${queryCollection}`)

    if (!userQuery) {
        res.status(400).json({ error: 'Search query "q" is required.' });
        return
    }

    try {
        const userId = req.user?._id.toString();
        if (!userId) {
            res.status(401).json({ error: 'Not authorized.' });
            return;
        }
        logger.info(`Search by ${userId}`);
        const response = await queryWeaviate(userId, userQuery as string, queryCollection as string);
        res.status(200).json(response);
        return;
    }
    catch (error) {
        logger.error('An error occurred during the search operation:', error);
        res.status(500).json({ error: 'Search failed due to an internal error.' });
        return
    }

}

// R10 — Click logging endpoint.
// Frontend posts here when a user clicks a search result. Records
// (userId, query, fileId, rank) for later CTR analysis and learned-rank
// training. Fire-and-forget: we never block the user.
const logSearchClick = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            res.status(401).json({ error: 'Not authorized.' });
            return;
        }
        const { query, fileId, rank } = req.body as {
            query?: string;
            fileId?: string;
            rank?: number;
        };
        if (!query || !fileId || typeof rank !== 'number' || rank < 1) {
            res.status(400).json({ error: 'Missing query/fileId/rank.' });
            return;
        }
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            res.status(400).json({ error: 'Invalid fileId.' });
            return;
        }
        const day = new Date().toISOString().slice(0, 10);
        // Fire and forget — return 200 immediately, don't block on the write.
        SearchClick.create({
            userId,
            query: query.trim().toLowerCase().slice(0, 500),
            fileId: new mongoose.Types.ObjectId(fileId),
            rank: Math.min(rank, 100),
            day,
        }).catch((err) => logger.warn(`searchClick insert failed: ${err}`));
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('logSearchClick failed:', error);
        res.status(500).json({ error: 'Server Error' });
    }
};

export { logSearchClick };
export default queryHandler;