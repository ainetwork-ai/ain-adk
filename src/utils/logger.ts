import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(
	({ level, message, timestamp, service, stack, ...meta }) => {
		const metaStr = Object.keys(meta).length
			? ` | ${JSON.stringify(meta)}`
			: "";
		const errorStack = stack ? `\n${stack}` : "";
		return `${timestamp} [${service}] ${level}: ${message}${metaStr}${errorStack}`;
	},
);

const createLogger = (service: string) => {
	const logFilePath = process.env.LOG_FILE_PATH;

	const transports: winston.transport[] = logFilePath
		? [
				new DailyRotateFile({
					filename: logFilePath,
					datePattern: "YYYY-MM-DD",
					maxSize: process.env.LOG_MAX_SIZE || "20m",
					maxFiles: process.env.LOG_MAX_FILES || "14d",
					format: combine(
						errors({ stack: true }),
						timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
						logFormat,
					),
				}),
			]
		: [
				new winston.transports.Console({
					format: combine(
						errors({ stack: true }),
						colorize(),
						timestamp({ format: "HH:mm:ss" }),
						logFormat,
					),
				}),
			];

	const logger = winston.createLogger({
		level: (process.env.LOG_LEVEL || "info").toLowerCase(),
		defaultMeta: { service },
		transports,
	});

	return logger;
};

// Default logger instance
export const logger = createLogger("ain-adk");

// Factory function for creating service-specific loggers
export const getLogger = (service: string) => createLogger(service);

// Convenience methods for different components
export const loggers = {
	agent: getLogger("AINAgent"),
	intent: getLogger("Intent"),
	intentStream: getLogger("IntentStream"),
	mcp: getLogger("MCPModule"),
	a2a: getLogger("A2AModule"),
	model: getLogger("Model"),
	server: getLogger("A2AServer"),
	fol: getLogger("FOL"),
} as const;
