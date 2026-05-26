import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service_name: 'sync-backend' },
  transports: [
    new winston.transports.Console(),
  ],
});

export default logger;
