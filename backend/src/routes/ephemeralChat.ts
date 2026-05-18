import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { chatLimiter, chatDailyLimiter } from "../middleware/rateLimit.js";
import {
    ephemeralUpload,
    uploadEphemeralFile,
    ephemeralChat,
    ephemeralChatStream,
    getEphemeralSessionText,
    closeEphemeralSession,
} from "../handlers/ephemeralChatHandler.js";

const ephemeralRouter = Router();

ephemeralRouter.post("/upload", verifyToken, ephemeralUpload.single("file"), uploadEphemeralFile);
ephemeralRouter.post("/:sessionId/chat", verifyToken, chatLimiter, chatDailyLimiter, ephemeralChat);
ephemeralRouter.post("/:sessionId/chat-stream", verifyToken, chatLimiter, chatDailyLimiter, ephemeralChatStream);
ephemeralRouter.get("/:sessionId/text", verifyToken, getEphemeralSessionText);
ephemeralRouter.delete("/:sessionId", verifyToken, closeEphemeralSession);

export default ephemeralRouter;
