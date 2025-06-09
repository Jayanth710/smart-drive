import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { upload, handleFileUpload } from '../handlers/uploadHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log(__dirname);
console.log(path.join(__dirname, '../../public/upload.html'))
const uploadRouter = Router();

// Serve upload.html from the same folder (routes/)
uploadRouter.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/upload.html'));
});

// Handle file upload
uploadRouter.post('/', upload.single('file'), handleFileUpload);

export default uploadRouter;
