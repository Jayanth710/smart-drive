import { Response, Request } from 'express';
import multer from 'multer';
import { uploadFileToGCS } from '../services/gcsUpload.js';
import { publishFileMetadata } from '../utils/pubsub.js';
import logger from '../logger.js';

// const uploadRouter = Router();
export const upload = multer({ storage: multer.memoryStorage() });

export const handleFileUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req.file as Express.Multer.File);

    if (!file) {
      logger.error('No file uploaded');
      res.status(400).send('No file uploaded');
    }

    const uploadRes = await uploadFileToGCS(file);

    if (uploadRes.isNew) {
      await publishFileMetadata(file, uploadRes.gcsUrl)

      res.status(200).json({
        message: 'File uploaded successfully',
        gcsUrl: uploadRes.gcsUrl,
      });
    }
    else {
      res.status(403).json({
        message: 'File already exists in GCS.',
        gcsUrl: uploadRes.gcsUrl
      })
    }
  } catch (error) {
    logger.error('GCS Upload Error:', error);
    res.status(500).send('Upload failed');
  }
};

// export default uploadRouter;
