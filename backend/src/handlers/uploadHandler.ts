import { Response } from 'express';
import multer from 'multer';
import { uploadFileToGCS } from '../services/gcsUpload.js';
import { publishFileMetadata } from '../utils/pubsub.js';
import logger from '../logger.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import UserFile from '../models/userFileModel.js';
import { getRecentUploads } from '../services/queryWeaviate.js';

export const upload = multer({ storage: multer.memoryStorage() });

const handleFileUpload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {

    const userId = req.user?._id?.toString();

    const file = (req.file as Express.Multer.File);
    const fileName = `${file.originalname.replace(/\s+/g, '_')}`;
    const { fileHash } = req.body;

    if (!file) {
      logger.error('No file was included in the request.');
      res.status(400).send('No file uploaded.');
      return;
    }
    if (!fileHash) {
      logger.error('No fileHash was included in the request body.');
      res.status(400).send('File hash is required.');
      return;
    }
    if (!userId) {
      logger.error('User not authenticated for file upload.');
      res.status(401).send('Authentication required.');
      return;
    }

    const fileExists = await UserFile.findOne({ userId, fileHash });
    if (fileExists) {
      logger.info(`File ${file.originalname} already exists for user ${userId}`);
      res.status(409).json({
        message: "File already exists for this user",
        gcsUrl: fileExists.gcsUrl,
      });
      return;
    }

    const uploadRes = await uploadFileToGCS(file, userId!, req.body.fileHash!);

    const savedFile = await UserFile.create({
      userId,
      fileName,
      gcsUrl: uploadRes.gcsUrl,
      fileType: file.mimetype,
      fileHash: fileHash,
    });

    logger.info(`File ${fileName} uploaded successfully for user ${userId}`);

    await publishFileMetadata(savedFile)

    res.status(200).json({
      message: "File uploaded successfully",
      gcsUrl: savedFile.gcsUrl,
      fileName: savedFile.fileName
    });
    return
  } catch (error) {
    logger.error('GCS Upload Error:', error);
    res.status(500).send('Upload failed');
    return
  }
};

const getUploads = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req?.user?._id.toString();

    const queryCollection = typeof req.query.queryCollection === "string" ? req.query.queryCollection : undefined;

    if (!userId) {
      res.status(401).send({ message: "User not Found" })
      return
    }

    logger.info("Fetching...")

    const results = await getRecentUploads(userId!, queryCollection!)
    res.status(200).send({ message: "Fetching Siccessful", data: results });
    return
  } catch (error: unknown) {
    res.status(500).send(`Internal Server Error ${error}`);
    return
  }
}

export {
  handleFileUpload,
  getUploads
};
