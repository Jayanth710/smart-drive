import { Response } from 'express';
import multer from 'multer';
import { uploadFileToGCS } from '../services/gcsUpload.js';
import { publishFileMetadata } from '../utils/pubsub.js';
import logger from '../logger.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import UserFile from '../models/userFileModel.js';
import { getWeaviateSummariesByFileIds } from '../services/queryWeaviate.js';

type CollectionFilter = 'all' | 'Documents' | 'Images' | 'Media';

const buildFileTypeQuery = (collection: CollectionFilter) => {
  switch (collection) {
    case 'Images':
      return { fileType: { $regex: '^image/' } };
    case 'Media':
      return { fileType: { $regex: '^(audio|video)/' } };
    case 'Documents':
      return { fileType: { $not: { $regex: '^(image|audio|video)/' } } };
    case 'all':
    default:
      return {};
  }
};

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

    let savedFile;
    try {
      savedFile = await UserFile.create({
        userId,
        fileName,
        gcsUrl: uploadRes.gcsUrl,
        fileType: file.mimetype,
        fileHash: fileHash,
        extractionStatus: 'pending',
      });
    } catch (err: unknown) {
      // E11000 = duplicate key. The unique index on (userId, fileHash)
      // catches the race where two concurrent uploads passed the findOne check.
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
        logger.info(`Race detected: file ${fileName} for user ${userId} was created concurrently`);
        const existing = await UserFile.findOne({ userId, fileHash });
        res.status(409).json({
          message: "File already exists for this user",
          gcsUrl: existing?.gcsUrl,
        });
        return;
      }
      throw err;
    }

    logger.info(`File ${fileName} uploaded successfully for user ${userId}`);

    try {
      await publishFileMetadata(savedFile);
    } catch (pubsubErr) {
      logger.error(`Pub/Sub publish failed for fileId ${savedFile._id}; file is uploaded but will not be extracted:`, pubsubErr);
      // Mark the file as failed so the UI shows it correctly.
      await UserFile.findByIdAndUpdate(savedFile._id, {
        extractionStatus: 'failed',
        extractionError: 'Failed to enqueue extraction job',
      });
      res.status(502).json({
        message: "File uploaded but indexing queue failed. Please retry.",
        gcsUrl: savedFile.gcsUrl,
        fileName: savedFile.fileName,
      });
      return;
    }

    res.status(200).json({
      message: "File uploaded successfully",
      gcsUrl: savedFile.gcsUrl,
      fileName: savedFile.fileName,
      file_id: savedFile._id.toString(),
      extraction_status: savedFile.extractionStatus,
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

    const queryCollection = (typeof req.query.queryCollection === "string" ? req.query.queryCollection : 'all') as CollectionFilter;

    if (!userId) {
      res.status(401).send({ message: "User not Found" })
      return
    }

    const mongoFilter = { userId, ...buildFileTypeQuery(queryCollection) };
    const files = await UserFile.find(mongoFilter).sort({ createdAt: -1 }).lean();

    // Enrich `done` files with their Weaviate summary so the UI can show it
    // without a second round-trip. Failed/pending/processing files have none.
    const doneFileIds = files
      .filter((f) => (f.extractionStatus ?? 'done') === 'done')
      .map((f) => f._id.toString());
    const enrichments = doneFileIds.length > 0
      ? await getWeaviateSummariesByFileIds(userId, doneFileIds)
      : new Map<string, Awaited<ReturnType<typeof getWeaviateSummariesByFileIds>> extends Map<string, infer V> ? V : never>();

    const results = files.map((f) => {
      // Legacy records (created before extractionStatus existed) → treat as done.
      const status = f.extractionStatus ?? 'done';
      const enrichment = enrichments.get(f._id.toString());
      return {
        file_id: f._id.toString(),
        filename: f.fileName,
        filetype: f.fileType,
        created_at: f.createdAt,
        extraction_status: status,
        extraction_error: f.extractionError,
        summary: enrichment?.summary,
        index_json: enrichment?.indexJson,
      };
    });

    res.status(200).send({ message: "Fetching Successful", data: results });
    return
  } catch (error: unknown) {
    logger.error('getUploads error:', error);
    res.status(500).send({ message: 'Internal Server Error' });
    return
  }
}

export {
  handleFileUpload,
  getUploads
};
