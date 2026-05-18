import logger from "../logger.js";

const RETRYABLE = /(429|5\d\d|rate.?limit|resource.?exhaust|deadline|timeout|timed out|unavailable|EAI_AGAIN|ECONNRESET|ECONNREFUSED)/i;
const NON_RETRYABLE = /(401|403|404|invalid.?argument|permission.?denied|not.?found)/i;

/** Google's 429 payload embeds `"retryDelay": "35s"`. Honour it when present. */
const extractRetryDelayMs = (msg: string): number | null => {
    const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
    if (!m) return null;
    const seconds = parseFloat(m[1]);
    if (!isFinite(seconds) || seconds <= 0) return null;
    // Cap at 60s — we don't want to hang a request for minutes.
    return Math.min(60_000, Math.ceil(seconds * 1000));
};

export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { label?: string; maxAttempts?: number; baseDelay?: number; maxDelay?: number } = {},
): Promise<T> {
    const { label = "call", maxAttempts = 3, baseDelay = 800, maxDelay = 6000 } = opts;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const msg = String(err);
            const nonRetryable = NON_RETRYABLE.test(msg) && !RETRYABLE.test(msg);
            if (attempt === maxAttempts || nonRetryable) {
                logger.warn(`retry ${label}: giving up after ${attempt}/${maxAttempts}: ${msg}`);
                throw err;
            }
            // Prefer the server's own retryDelay hint over exponential backoff.
            const hinted = extractRetryDelayMs(msg);
            const expo = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
            const base = hinted ?? expo;
            const jittered = base + Math.random() * 500;
            logger.info(`retry ${label}: attempt ${attempt}/${maxAttempts} failed (${hinted ? `server hinted ${hinted}ms` : `${msg.slice(0, 80)}…`}); sleeping ${Math.round(jittered)}ms`);
            await new Promise((r) => setTimeout(r, jittered));
        }
    }
    throw lastErr;
}
