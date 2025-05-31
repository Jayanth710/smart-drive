import { Router, Response, Request } from 'express';
import multer from 'multer';
import { uploadFileToGCS } from '../utils/gcsUpload.js';

const uploadRouter = Router();
export const upload = multer({ storage: multer.memoryStorage() });

export const handleFileUpload = async (req: Request, res: Response): Promise<void> => {
    try {
        const file = (req.file as Express.Multer.File);
  
      if (!file) res.status(400).send('No file uploaded');
  
      const gcsUrl = await uploadFileToGCS(file);
  
      res.status(200).json({
        message: 'File uploaded successfully',
        gcsUrl,
      });
    } catch (error) {
      console.error('GCS Upload Error:', error);
      res.status(500).send('Upload failed');
    }
  };

export default uploadRouter;
