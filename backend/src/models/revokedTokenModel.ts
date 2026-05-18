import mongoose from "mongoose";

export interface RevokedTokenType extends mongoose.Document {
    jti: string;
    expiresAt: Date;
}

const revokedTokenSchema = new mongoose.Schema(
    {
        jti: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
            // Mongo TTL monitor will delete docs once expiresAt has passed,
            // so the collection size never exceeds outstanding live tokens.
            expires: 0,
        },
    },
    {
        timestamps: true,
    }
);

const RevokedToken = mongoose.model<RevokedTokenType>("RevokedToken", revokedTokenSchema);

export default RevokedToken;
