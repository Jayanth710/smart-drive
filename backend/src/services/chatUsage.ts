import ChatUsage from "../models/chatUsageModel.js";
import logger from "../logger.js";

const todayKey = (): string => new Date().toISOString().slice(0, 10);

/**
 * Fire-and-forget usage increment. Bad day for Mongo shouldn't break chat.
 */
export const recordChatUsage = (userId: string, kind: "persistent" | "ephemeral"): void => {
    const day = todayKey();
    const inc: Record<string, number> = { messages: 1 };
    if (kind === "persistent") inc.persistent_messages = 1;
    else inc.ephemeral_messages = 1;

    ChatUsage.updateOne(
        { userId, day },
        { $inc: inc, $setOnInsert: { userId, day } },
        { upsert: true },
    ).catch((err) => logger.warn(`recordChatUsage failed: ${err}`));
};
