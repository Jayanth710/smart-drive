import winston from 'winston';
import { getRequestId } from './middleware/requestContext.js';

/**
 * Production: JSON lines that can be ingested by Cloud Logging / Datadog /
 * Loki without a custom parser.
 * Dev: pretty-printed for human eyes.
 *
 * Every line auto-includes the request_id from AsyncLocalStorage so traces
 * stitch together end-to-end.
 */

const isProd = process.env.NODE_ENV === 'production';

const enrich = winston.format((info) => {
    const id = getRequestId();
    if (id) info.request_id = id;
    info.service = 'smartdrive';
    return info;
});

const devPretty = winston.format.printf(({ level, message, timestamp, request_id, ...meta }) => {
    const idPart = request_id ? `[${request_id}]` : '';
    const metaJson = Object.keys(meta).length && meta.service === undefined
        ? ' ' + JSON.stringify(meta)
        : '';
    return `[${timestamp}] ${idPart} ${String(level).toUpperCase()}: ${message}${metaJson}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        enrich(),
        isProd ? winston.format.json() : devPretty,
    ),
    transports: [new winston.transports.Console()],
});

export default logger;
