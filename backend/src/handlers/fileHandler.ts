import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import UserFile, { UserFileType } from "../models/userFileModel.js";
import logger from "../logger.js";
import { GetSignedUrlConfig } from "@google-cloud/storage";
import { bucket } from "../services/gcsUpload.js";
import { deleteWeaviateFile } from "../services/queryWeaviate.js";

const getUserFile = (fileRecord: UserFileType | null) => {
    const filePath = `${fileRecord?.userId}/${fileRecord?.fileHash}`;
    return bucket.file(filePath);
};

const fileExistsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { hash } = req.query;

    try {
        const userId = req.user?._id.toString();
        const fileExists = await UserFile.findOne({ userId: userId, fileHash: hash })

        if (fileExists) {
            res.status(200).send({ message: "File exists" });
            return;
        }
        res.status(404).send({ message: "File does not exist" });
        return;
    } catch (error) {
        logger.error(error)
        res.status(500).send({ message: "Internal server error" });
        return;
    }

}

const generateFileSignedUrl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params
    const { action } = req.query

    if (!userId) {
        res.status(401).json({ message: 'User not found' })
        return
    };
    if (!fileId) {
        res.status(400).json({ message: 'File name is required' })
        return
    };

    try {

        const fileRecord = await UserFile.findById(fileId);

        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            logger.warn(`User ${userId} attempted to access unauthorized file ${fileId}`);
            res.status(403).json({ message: "Forbidden: You do not have access to this file." });
            return
        }

        const file = getUserFile(fileRecord);

        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).json({ message: 'File not found' });
            return
        }

        const options: GetSignedUrlConfig = {
            version: 'v4',
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000,
        };

        if (action === 'download') {
            options.responseDisposition = `attachment; filename="${fileRecord?.fileName}"`;
        }

        const [url] = await file.getSignedUrl(options);
        res.status(200).json({ url });
        return

    } catch (error) {
        logger.error(`Failed to generate signed URL for ${fileId}:`, error);
        res.status(500).json({ message: 'Could not generate file URL.' });
        return
    }


}

const deleteFile = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id.toString();
    const { fileId } = req.params

    if (!userId) {
        res.status(401).json({ message: 'User not found' });
        return
    }
    if (!fileId) {
        res.status(400).json({ message: 'File name is required' });
        return
    }

    try {
        const fileRecord = await UserFile.findById(fileId);

        if (!fileRecord || fileRecord.userId.toString() !== userId) {
            logger.warn(`User ${userId} attempted to access unauthorized file ${fileId}`);
            res.status(403).json({ message: "Forbidden: You do not have access to this file." });
            return
        }

        let targetCollection: string;
        const mainFileType = fileRecord?.fileType.split('/')[0];

        if (mainFileType === 'image') {
            targetCollection = 'SmartDriveImages';
        } else if (mainFileType === 'audio' || mainFileType === 'video') {
            targetCollection = 'SmartDriveMedia';
        } else {
            targetCollection = 'SmartDriveDocuments';
        }

        const file = getUserFile(fileRecord);

        const [exists] = await file.exists();
        if (!exists) {
            res.status(404).json({ message: 'File not found' });
            return
        }

        const [gcsSuccess, weaviateSuccess] = await Promise.all([
            file.delete(),
            deleteWeaviateFile(userId!, fileRecord?._id.toString(), targetCollection)
        ]);

        if (!gcsSuccess || !weaviateSuccess) {
            throw new Error(`Failed to delete file assets for fileId: ${fileId}`);
        }
        await UserFile.findByIdAndDelete(fileId)

        logger.info(`Successfully deleted ${fileRecord?.fileName}`)
        res.status(200).send({ message: `Successfully deleted ${fileRecord?.fileName}` })
        return
    } catch (error: unknown) {
        if (error) {
            logger.warn(`File not found, nothing to delete.`);
            res.status(500).json({ error: 'Deletion failed due to an internal error.' });
            return
        }
    }
}

export {
    fileExistsHandler,
    generateFileSignedUrl,
    deleteFile
}

