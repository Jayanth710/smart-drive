import { Router } from "express";
import { deleteFile, fileExistsHandler, generateFileSignedUrl, triggerExtraction, chatWithFile, chatWithFileStream, prepareChat, getFileText } from "../handlers/fileHandler.js";
import { verifyToken } from "../middleware/auth.js";
import { chatLimiter, chatDailyLimiter } from "../middleware/rateLimit.js";

const fileRouter = Router();

fileRouter.get("/exists", verifyToken, fileExistsHandler);
fileRouter.get('/:fileId/url', verifyToken, generateFileSignedUrl);
fileRouter.delete('/:fileId', verifyToken, deleteFile);
fileRouter.post('/:fileId/extract', verifyToken, triggerExtraction);
fileRouter.get('/:fileId/text', verifyToken, getFileText);
fileRouter.post('/:fileId/prepare-chat', verifyToken, prepareChat);
fileRouter.post('/:fileId/chat', verifyToken, chatLimiter, chatDailyLimiter, chatWithFile);
fileRouter.post('/:fileId/chat-stream', verifyToken, chatLimiter, chatDailyLimiter, chatWithFileStream);

export default fileRouter;
