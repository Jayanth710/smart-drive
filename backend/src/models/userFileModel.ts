import mongoose from "mongoose";

export interface UserFile extends mongoose.Document {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    fileName: string;
    gcsUrl: string;
    fileType: string;
    fileHash: string;
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
            index: true,
        }
    },
    {
        timestamps: true,  // adds createdAt and updatedAt
    }
);

userFileSchema.index({ userId: 1, fileName: 1 }, { unique: true });

const UserFile = mongoose.model("UserFile", userFileSchema);

export default UserFile;