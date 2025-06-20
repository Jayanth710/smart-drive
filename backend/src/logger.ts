import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
    // winston.format.printf(({ level, message, timestamp, ...meta }) => {
    //   const metaInfo = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
    //   return `[${timestamp}] ${level.toUpperCase()}: ${message} ${metaInfo}`;
    // })
  ),
  defaultMeta: { service: 'smartdrive' },
  transports: [
    new winston.transports.Console()
  ],
});

export default logger;