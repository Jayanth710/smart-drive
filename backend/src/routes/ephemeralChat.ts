import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
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
ephemeralRouter.post("/:sessionId/chat", verifyToken, ephemeralChat);
ephemeralRouter.post("/:sessionId/chat-stream", verifyToken, ephemeralChatStream);
ephemeralRouter.get("/:sessionId/text", verifyToken, getEphemeralSessionText);
ephemeralRouter.delete("/:sessionId", verifyToken, closeEphemeralSession);

export default ephemeralRouter;
