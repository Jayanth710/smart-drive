/**
 * In-memory store for ephemeral "chat with a one-off file" sessions.
 *
 * The whole point of this mode is that nothing touches GCS / Mongo / Weaviate.
 * The file is parsed in memory, chunks + vectors live in this Map, and when
 * the user closes the session we drop the entry.
 *
 * Idle entries are auto-evicted after `IDLE_TTL_MS` so a forgotten tab doesn't
 * pin a 50-MB document forever. A periodic sweep keeps the map bounded.
 *
 * Single-instance only — for a multi-instance deployment, swap this for Redis
 * (interface stays the same).
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";

export type EphemeralChunk = {
    index: number;
    text: string;
    /** Parent-document context used at answer time (parent-document retrieval). */
    parent_text: string;
    parent_index: number;
    has_table: boolean;
    vector: number[];
};

export type EphemeralSession = {
    id: string;
    userId: string;
    filename: string;
    filetype: string;
    chunks: EphemeralChunk[];
    rawText: string;
    createdAt: number;
    lastUsedAt: number;
};

const IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS_PER_USER = 5;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, EphemeralSession>();

const sweep = () => {
    const now = Date.now();
    let evicted = 0;
    for (const [id, sess] of sessions) {
        if (now - sess.lastUsedAt > IDLE_TTL_MS) {
            sessions.delete(id);
            evicted++;
        }
    }
    if (evicted > 0) {
        logger.info(`ephemeral-chat: swept ${evicted} idle sessions; ${sessions.size} remain`);
    }
};

// One sweep timer per process. Doesn't keep Node alive on its own (unref).
setInterval(sweep, SWEEP_INTERVAL_MS).unref?.();

const enforcePerUserCap = (userId: string) => {
    const userSessions = Array.from(sessions.values())
        .filter((s) => s.userId === userId)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    while (userSessions.length >= MAX_SESSIONS_PER_USER) {
        const oldest = userSessions.shift();
        if (oldest) {
            sessions.delete(oldest.id);
            logger.info(`ephemeral-chat: evicted oldest session ${oldest.id} for user ${userId} (cap=${MAX_SESSIONS_PER_USER})`);
        }
    }
};

export const createSession = (
    userId: string,
    filename: string,
    filetype: string,
    rawText: string,
    chunks: EphemeralChunk[],
): EphemeralSession => {
    enforcePerUserCap(userId);
    const id = randomUUID();
    const now = Date.now();
    const sess: EphemeralSession = {
        id,
        userId,
        filename,
        filetype,
        chunks,
        rawText,
        createdAt: now,
        lastUsedAt: now,
    };
    sessions.set(id, sess);
    return sess;
};

export const getSession = (id: string, userId: string): EphemeralSession | null => {
    const sess = sessions.get(id);
    if (!sess) return null;
    if (sess.userId !== userId) return null;
    if (Date.now() - sess.lastUsedAt > IDLE_TTL_MS) {
        sessions.delete(id);
        return null;
    }
    sess.lastUsedAt = Date.now();
    return sess;
};

export const deleteSession = (id: string, userId: string): boolean => {
    const sess = sessions.get(id);
    if (!sess || sess.userId !== userId) return false;
    sessions.delete(id);
    return true;
};

export const sessionStats = () => ({
    total: sessions.size,
    by_user: Array.from(sessions.values()).reduce<Record<string, number>>((acc, s) => {
        acc[s.userId] = (acc[s.userId] || 0) + 1;
        return acc;
    }, {}),
});
