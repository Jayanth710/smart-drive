/**
 * Detect conversational pleasantries / non-questions and return a canned
 * friendly reply without calling the retrieval pipeline.
 *
 * Catches the common "Thanks", "Ok", "Got it" case where the user is just
 * acknowledging, not asking a new question. Treating those as queries leads
 * to weird rewrites and unnecessary refusals.
 *
 * Strict: only matches obvious non-questions. Anything that looks like a real
 * question ("what about X?") falls through to the full RAG pipeline.
 */

import type { ChatAnswer } from "./chatPipeline.js";

const PLEASANTRIES: Record<string, string> = {
    "thanks": "You're welcome! Let me know if there's anything else you'd like to ask about this file.",
    "thank you": "You're welcome! Let me know if there's anything else you'd like to ask about this file.",
    "thx": "You're welcome!",
    "ty": "You're welcome!",
    "ok": "Got it. Ask me anything else about this file.",
    "okay": "Got it. Ask me anything else about this file.",
    "k": "Got it.",
    "got it": "Glad that helped. Anything else?",
    "great": "Glad I could help. Anything else?",
    "cool": "Glad I could help. Anything else?",
    "nice": "Glad I could help. Anything else?",
    "perfect": "Glad I could help. Anything else?",
    "awesome": "Glad I could help. Anything else?",
    "yes": "Could you tell me a bit more about what you'd like to know?",
    "no": "No problem — let me know if you have a different question.",
    "nope": "No problem — let me know if you have a different question.",
    "yep": "Got it.",
    "hi": "Hi! What would you like to know about this file?",
    "hello": "Hello! What would you like to know about this file?",
    "hey": "Hey! What would you like to know about this file?",
    "good morning": "Good morning! What would you like to know about this file?",
    "good afternoon": "Good afternoon! What would you like to know about this file?",
    "good evening": "Good evening! What would you like to know about this file?",
    "bye": "Bye! Your session will be cleaned up when you close the tab.",
    "goodbye": "Goodbye! Your session will be cleaned up when you close the tab.",
    "good night": "Good night!",
};

const STRIP_RE = /[^a-z ]+/g;

/**
 * Returns a canned ChatAnswer if the message is a recognised pleasantry,
 * or null to let the full pipeline run.
 */
export const smallTalkReply = (message: string): ChatAnswer | null => {
    const trimmed = (message ?? "").trim();
    if (!trimmed || trimmed.length > 30) return null;

    // Lowercase + drop punctuation/emoji, collapse spaces.
    const normalized = trimmed.toLowerCase().replace(STRIP_RE, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    // Exact-match against the table.
    const direct = PLEASANTRIES[normalized];
    if (direct) {
        return {
            answer: direct,
            sources: [],
            confidence: "high",
            refused: false,
            out_of_scope: false,
        };
    }

    return null;
};
