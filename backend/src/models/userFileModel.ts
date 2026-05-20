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
    extractionError?: string | null;
    /** True once per-chunk vectors have been computed and stored in Weaviate.
     *  Lazy: only flipped when a user starts a chat with the file. */
    chatReady?: boolean;
    /** When true, the worker skips all LLM calls. No summary, no entity extraction,
     *  no body embedding, no chunks. Only filename + metadata are indexed so the
     *  user can still find the file by name. Chat is disabled for private files. */
    isPrivate?: boolean;
    /** Personalization signal — files the user interacts with rank higher in
     *  search. Touched on chat-prep, chat-stream, view, download. */
    lastAccessedAt?: Date | null;
    accessCount?: number;
    /** Extraction progress for UI ("extracting page 3 of 12"). Worker
     *  updates this periodically during processing. Cleared when status='done'. */
    extractionProgress?: { current: number; total: number; stage: string } | null;
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
        chatReady: {
            type: Boolean,
            default: false,
        },
        isPrivate: {
            type: Boolean,
            default: false,
            index: true,
        },
        lastAccessedAt: { type: Date, default: null },
        accessCount: { type: Number, default: 0 },
        extractionProgress: {
            current: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            stage: { type: String, default: "" },
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
