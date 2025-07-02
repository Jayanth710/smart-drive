import { Storage } from '@google-cloud/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
// import logger from '../logger.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceKeyPath = path.join(__dirname, '../../smartdrive-service-account.json');

interface UploadResult {
  gcsUrl: string;
}

const isLocal = process.env.NODE_ENV === 'local';
// { keyFilename: serviceKeyPath}
export const storage = isLocal ? new Storage({ keyFilename: serviceKeyPath }) : new Storage();
export const bucket = storage.bucket('smartdrive_storage');

// const checkFileExistsGCS = async (fileName: string) => {

//   try {
//     const file = bucket.file(fileName);
//     console.log(`Checking for gs://${bucket.name}/${fileName}...`);
//     const [exists] = await file.exists();

//     return exists;
//   } catch (error) {
//     logger.error('An error occurred:', error);
//     return false;
//   }
// }

export const uploadFileToGCS = async (file: Express.Multer.File, userId: string, fileHash: string): Promise<UploadResult> => {
  const originalFileName = file.originalname.replace(/\s+/g, '_')
  const fileName = `${userId}/${fileHash}`;

  // const fileExists = await checkFileExistsGCS(fileName)

  // if (fileExists) {
  //   logger.info(`File ${fileName} already exists in GCS.`);
  //   return {
  //     gcsUrl: `https://storage.googleapis.com/${bucket.name}/${fileName}`,
  //     isNew: false
  //   };
  // }

  const blob = bucket.file(fileName);

  const blobStream = blob.createWriteStream({
    resumable: false,
    metadata: {
      contentType: file.mimetype,
      fileName: originalFileName,
      metadata: {
        userId: userId,
      },
    },
  });
  return new Promise(async (resolve, reject) => {


    blobStream.on('error', (err) => reject(err));

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve({
        gcsUrl: publicUrl
      });
    });

    blobStream.end(file.buffer);
  });
};
