import mongoose from "mongoose";

export type ExtractionStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface UserFileType extends mongoose.Document {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    fileName: string;
    gcsUrl: string;
    fileType: string;
    fileHash: string;
    extractionStatus: ExtractionStatus;
    extractionError?: string;
    createdAt: Date;
    updatedAt: Date;
}

const userFileSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        fileName: {
            type: String,
            required: true,
            trim: true,
        },
        gcsUrl: {
            type: String,
            required: true,
        },
        fileType: {
            type: String,
            required: true,
        },
        fileHash: {
            type: String,
            required: true,
        },
        extractionStatus: {
            type: String,
            enum: ['pending', 'processing', 'done', 'failed'],
            default: 'pending',
            index: true,
        },
        extractionError: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

userFileSchema.index({ userId: 1, fileHash: 1 }, { unique: true });
userFileSchema.index({ userId: 1, fileName: 1 }, { unique: true });

const UserFile = mongoose.model("UserFile", userFileSchema);

export default UserFile;
