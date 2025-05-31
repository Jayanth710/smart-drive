// import { Request, Response } from 'express';
// import multer, { FileFilterCallback, StorageEngine } from 'multer';
// import path from 'path';
// import fs from 'fs';
// import { fileURLToPath } from 'url';
// import { uploadFileToGCS } from '../utils/gcsUpload.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const uploadDir = path.join(__dirname, '../../uploads');
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
// }

// const storage: StorageEngine = multer.diskStorage({
//   destination: (req: Request, file, cb: (error: Error | null, destination: string) => void) => {
//     cb(null, uploadDir);
//   },
//   filename: (_req: Request, file, cb: (error: Error | null, filename: string) => void) => {
//     const ext = path.extname(file.originalname);
//     cb(null, `${Date.now()}-${file.fieldname}${ext}`);
//   }
// });

// const fileFilter = (_req: Request, file: any, cb: FileFilterCallback) => {
//   const allowed = [
//     'application/pdf',
//     'application/msword',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     'text/plain',
//     'image/jpeg',
//     'image/png',
//     'video/mp4',
//     'audio/mpeg',
//     'audio/wav'
//   ];
//   if (allowed.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(new Error('Unsupported file type'));
//   }
// };

// export const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: 100 * 1024 * 1024 }
// });

// export const handleFileUpload = (req: Request, res: Response) => {
//   const file = (req as any).file;

//   if (!file) {
//     return res.status(400).json({ error: 'No file uploaded' });
//   }

//   return res.status(200).json({
//     message: 'File uploaded successfully',
//     fileInfo: {
//       filename: file.filename,
//       mimetype: file.mimetype,
//       size: file.size,
//       path: file.path
//     }
//   });
// };
// src/routes/uploadRouter.ts
import { Router } from 'express';
import multer from 'multer';
import { uploadFileToGCS } from '../utils/gcsUpload.js';

const uploadRouter = Router();
export const upload = multer({ storage: multer.memoryStorage() });

export const handleFileUpload = async (req: Request, res: any) => {
    try {
        const file = (req as any).file;
  
      if (!file) return res.status(400).send('No file uploaded');
  
      const gcsUrl = await uploadFileToGCS(file);
  
      return res.status(200).json({
        message: 'File uploaded successfully',
        gcsUrl,
      });
    } catch (error) {
      console.error('GCS Upload Error:', error);
      return res.status(500).send('Upload failed');
    }
  };

export default uploadRouter;
