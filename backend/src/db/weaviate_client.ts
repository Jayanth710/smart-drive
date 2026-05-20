import weaviate, { WeaviateClient } from 'weaviate-client';
import logger from '../logger.js';

const WEAVIATE_URL = process.env.WEAVIATE_URL as string;
const WEAVIATE_API_KEY = process.env.WEAVIATE_API_KEY as string;

// ---------- Singleton connection ----------
// Previously, every call to getWeaviateClient() created a NEW connection,
// adding 200-500ms TCP+TLS handshake to every search and chat query.
// Now we reuse one client across the process lifetime.

let _client: WeaviateClient | null = null;
let _connecting: Promise<WeaviateClient | null> | null = null;

const _connect = async (): Promise<WeaviateClient | null> => {
    if (!WEAVIATE_URL || !WEAVIATE_API_KEY) {
        logger.error("WEAVIATE_URL or WEAVIATE_API_KEY environment variables not set.");
        return null;
    }
    try {
        const c = await weaviate.connectToWeaviateCloud(
            WEAVIATE_URL,
            { authCredentials: new weaviate.ApiKey(WEAVIATE_API_KEY) },
        );
        logger.info("Successfully connected to Weaviate (cached for process lifetime).");
        return c;
    } catch (e) {
        logger.error(`Failed to connect to Weaviate: ${e}`);
        return null;
    }
};

const getWeaviateClient = async (): Promise<WeaviateClient | null> => {
    if (_client) return _client;

    // If a connection is already being established, await the same promise
    // instead of starting a second handshake (avoids thundering-herd on cold start).
    if (_connecting) return _connecting;

    _connecting = _connect().then((c) => {
        _client = c;
        _connecting = null;
        return c;
    });
    return _connecting;
};

// ---------- Pre-warm on boot ----------
// Called from app.ts at startup so the first request doesn't pay connection cost.

export const warmupWeaviate = async (): Promise<void> => {
    const start = Date.now();
    const c = await getWeaviateClient();
    if (c) {
        try {
            await c.isLive();
            logger.info(`Weaviate warmup OK in ${Date.now() - start}ms`);
        } catch (e) {
            logger.warn(`Weaviate warmup failed: ${e}`);
        }
    }
};

// ---------- Keepalive ----------
// Cloud Run keeps idle TCP for some time, but Weaviate Cloud may also drop
// connections after periods of inactivity. A periodic isLive() ping keeps
// the connection warm and lets us detect dropped connections early.

const KEEPALIVE_MS = 5 * 60 * 1000; // 5 minutes
let _keepaliveTimer: NodeJS.Timeout | null = null;

export const startWeaviateKeepalive = (): void => {
    if (_keepaliveTimer) return; // already running
    _keepaliveTimer = setInterval(async () => {
        try {
            const c = await getWeaviateClient();
            if (c) await c.isLive();
        } catch (e) {
            // If the keepalive fails, reset the client so the next real query
            // re-establishes. Better to fail fast than serve from a dead conn.
            logger.warn(`Weaviate keepalive failed, resetting client: ${e}`);
            _client = null;
        }
    }, KEEPALIVE_MS);
    // Don't keep the process alive just for this timer.
    if (typeof _keepaliveTimer.unref === "function") _keepaliveTimer.unref();
    logger.info(`Weaviate keepalive started (interval ${KEEPALIVE_MS / 1000}s)`);
};

export default getWeaviateClient;
