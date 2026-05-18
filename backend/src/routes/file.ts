import { Router } from "express";
import { deleteFile, fileExistsHandler, generateFileSignedUrl, triggerExtraction } from "../handlers/fileHandler.js";
import { verifyToken } from "../middleware/auth.js";

const fileRouter = Router();

fileRouter.get("/exists", verifyToken, fileExistsHandler);
fileRouter.get('/:fileId/url', verifyToken, generateFileSignedUrl)
fileRouter.delete('/:fileId', verifyToken, deleteFile)
fileRouter.post('/:fileId/extract', verifyToken, triggerExtraction)

export default fileRouter;