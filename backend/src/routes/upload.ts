import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { upload, handleFileUpload, getUploads } from '../handlers/uploadHandler.js';
import { verifyToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRouter = Router();

// Serve upload.html from the same folder (routes/)
// uploadRouter.get('/', (_req, res) => {
//   res.sendFile(path.join(__dirname, '../../public/upload.html'));
// });

// Handle file upload
uploadRouter.post('/', verifyToken, upload.single('file'), handleFileUpload);
uploadRouter.get('/', verifyToken, getUploads)

export default uploadRouter;
