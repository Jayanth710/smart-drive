import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const serviceKeyPath = path.join(__dirname, '../../smartdrive-service-account.json');
// { keyFilename: serviceKeyPath}
const storage = new Storage();
const bucket = storage.bucket('smartdrive_storage');

export const uploadFileToGCS = async (file: Express.Multer.File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fileName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    const blob = bucket.file(fileName);

    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    blobStream.on('error', (err) => reject(err));

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve(publicUrl);
    });

    blobStream.end(file.buffer);
  });
};
