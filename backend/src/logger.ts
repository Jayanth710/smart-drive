import winston from 'winston';
import { getRequestId } from './middleware/requestContext.js';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      const requestId = getRequestId();
      const prefix = requestId ? `[${timestamp}] [${requestId}]` : `[${timestamp}]`;
      return `${prefix} ${level.toUpperCase()}: ${message}`;
    })
  ),
  defaultMeta: { service: 'smartdrive' },
  transports: [
    new winston.transports.Console()
  ],
});

export default logger;
