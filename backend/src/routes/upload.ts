import { Router } from 'express';
import { upload, handleFileUpload, getUploads } from '../handlers/uploadHandler.js';
import { verifyToken } from '../middleware/auth.js';

const uploadRouter = Router();

uploadRouter.post('/', verifyToken, upload.single('file'), handleFileUpload);
uploadRouter.get('/', verifyToken, getUploads)

export default uploadRouter;
