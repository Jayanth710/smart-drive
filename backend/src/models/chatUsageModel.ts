import mongoose from "mongoose";

/**
 * Per-user/per-day chat usage tally. Cheap counter — incremented on every
 * chat call. Used for: dashboards, soft daily limits, billing later.
 */
export interface ChatUsageType extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    /** Date in YYYY-MM-DD form (UTC) so aggregation is trivial. */
    day: string;
    messages: number;
    persistent_messages: number;
    ephemeral_messages: number;
    createdAt: Date;
    updatedAt: Date;
}

const schema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        day: { type: String, required: true, index: true },
        messages: { type: Number, default: 0 },
        persistent_messages: { type: Number, default: 0 },
        ephemeral_messages: { type: Number, default: 0 },
    },
    { timestamps: true }
);

schema.index({ userId: 1, day: 1 }, { unique: true });

const ChatUsage = mongoose.model<ChatUsageType>("ChatUsage", schema);
export default ChatUsage;
