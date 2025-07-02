import { Router } from "express";
import { deleteFile, fileExistsHandler, generateFileSignedUrl } from "../handlers/fileHandler.js";
import { verifyToken } from "../middleware/auth.js";

const fileRouter = Router();

fileRouter.get("/exists", verifyToken, fileExistsHandler);
fileRouter.get('/:fileId/url', verifyToken, generateFileSignedUrl)
fileRouter.delete('/:fileId', verifyToken, deleteFile)

export default fileRouter;