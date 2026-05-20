import mongoose from "mongoose";

/**
 * R10 — Click logging.
 * Stores (user, query, clicked_file_id, rank) tuples so we can:
 *   1. Compute CTR@1 (% of clicks at position 1) — cheap quality signal
 *   2. Spot pathological queries (zero-click queries) — broken searches
 *   3. Train a learned ranker once volume justifies it
 *
 * Lightweight: one document per click, indexed by (userId, day) for fast
 * dashboards. TTL on createdAt to auto-prune older than 90 days.
 */
export interface SearchClickType extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    /** Normalized query string (trimmed + lowercased). */
    query: string;
    /** ID of the file the user clicked. */
    fileId: mongoose.Types.ObjectId;
    /** Position in the result list (1-based). */
    rank: number;
    /** Day in YYYY-MM-DD (UTC) for cheap aggregation. */
    day: string;
    createdAt: Date;
}

const schema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        query: { type: String, required: true, maxlength: 500 },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "UserFile", required: true },
        rank: { type: Number, required: true, min: 1, max: 100 },
        day: { type: String, required: true, index: true },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

// TTL: auto-delete clicks older than 90 days.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
// Common analytics query: clicks for a user, sorted by day desc.
schema.index({ userId: 1, day: -1 });

const SearchClick = mongoose.model<SearchClickType>("SearchClick", schema);
export default SearchClick;
