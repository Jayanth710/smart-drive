import { Router } from "express";
import { deleteFile, fileExistsHandler, generateFileSignedUrl, triggerExtraction, chatWithFile, chatWithFileStream, prepareChat } from "../handlers/fileHandler.js";
import { verifyToken } from "../middleware/auth.js";

const fileRouter = Router();

fileRouter.get("/exists", verifyToken, fileExistsHandler);
fileRouter.get('/:fileId/url', verifyToken, generateFileSignedUrl)
fileRouter.delete('/:fileId', verifyToken, deleteFile)
fileRouter.post('/:fileId/extract', verifyToken, triggerExtraction)
fileRouter.post('/:fileId/prepare-chat', verifyToken, prepareChat)
fileRouter.post('/:fileId/chat', verifyToken, chatWithFile)
fileRouter.post('/:fileId/chat-stream', verifyToken, chatWithFileStream)

export default fileRouter;
