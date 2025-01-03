const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
require('fs').mkdirSync(logsDir, { recursive: true });

const transport = new winston.transports.File({
    filename: path.join(logsDir, 'actions.log'),
    maxsize: 100 * 1024, // 10MB
    maxFiles: 10,
    tailable: true,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    )
});

const logger = winston.createLogger({
    transports: [transport]
});

const logAdminAction = (Email, action, content) => {
    logger.info({
        Email,
        action,
        content
    });
};

module.exports = { logAdminAction };