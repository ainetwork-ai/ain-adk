import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const createLogger = (service: string) => {
	const logger = winston.createLogger({
		level: (process.env.LOG_LEVEL || "info").toLowerCase(),
		format: combine(
			errors({ stack: true }),
			colorize(),
			timestamp({ format: "HH:mm:ss" }),
			printf(({ level, message, timestamp, service, stack, ...meta }) => {
				const metaStr = Object.keys(meta).length
					? ` | ${JSON.stringify(meta)}`
					: "";
				const errorStack = stack ? `\n${stack}` : "";
				return `${timestamp} [${service}] ${level}: ${message}${metaStr}${errorStack}`;
			}),
		),
		defaultMeta: { service },
		transports: [new winston.transports.Console()],
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
	mcp: getLogger("MCPModule"),
	a2a: getLogger("A2AModule"),
	model: getLogger("Model"),
	server: getLogger("A2AServer"),
	fol: getLogger("FOL"),
} as const;
