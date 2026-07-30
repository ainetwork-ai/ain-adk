import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getRequestContext } from "@/utils/request-context";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Merges the ambient request context into every log entry so lines from
// interleaved concurrent requests stay correlatable. Values passed
// explicitly at the call site win over the ambient ones.
export const injectRequestContext = winston.format((info) => {
	const ctx = getRequestContext();
	if (!ctx) return info;
	info.requestId ??= ctx.requestId;
	if (ctx.userId !== undefined) info.userId ??= ctx.userId;
	if (ctx.threadId !== undefined) info.threadId ??= ctx.threadId;
	return info;
});

export const textLogFormat = printf(
	({ level, message, timestamp, service, stack, requestId, ...meta }) => {
		const reqTag = requestId ? ` [req:${String(requestId).slice(0, 8)}]` : "";
		const metaStr = Object.keys(meta).length
			? ` | ${JSON.stringify(meta)}`
			: "";
		const errorStack = stack ? `\n${stack}` : "";
		return `${timestamp} [${service}]${reqTag} ${level}: ${message}${metaStr}${errorStack}`;
	},
);

export type LogOutput = "file" | "console";

// File output defaults to structured JSON lines (grep/jq/lnav-friendly);
// the dev console stays human-readable. LOG_FORMAT=json|text overrides both.
export const resolveLogFormat = (output: LogOutput): "json" | "text" => {
	const override = process.env.LOG_FORMAT?.toLowerCase();
	if (override === "json" || override === "text") return override;
	return output === "file" ? "json" : "text";
};

// Rotated file names get a .jsonl suffix (after the date) when the file
// output is JSON lines, so new files are recognizable by tools and by eye.
// Text mode keeps the legacy extension-less names.
export const logFileExtension = (logFilePath: string): string => {
	if (resolveLogFormat("file") !== "json") return "";
	return /\.jsonl?$/.test(logFilePath) ? "" : ".jsonl";
};

const buildFormat = (output: LogOutput) => {
	if (resolveLogFormat(output) === "json") {
		return combine(
			errors({ stack: true }),
			injectRequestContext(),
			timestamp(),
			json(),
		);
	}
	return combine(
		errors({ stack: true }),
		injectRequestContext(),
		...(output === "console" ? [colorize()] : []),
		timestamp({
			format: output === "file" ? "YYYY-MM-DD HH:mm:ss" : "HH:mm:ss",
		}),
		textLogFormat,
	);
};

const createLogger = (service: string) => {
	const logFilePath = process.env.LOG_FILE_PATH;

	const transports: winston.transport[] = logFilePath
		? [
				new DailyRotateFile({
					filename: logFilePath,
					extension: logFileExtension(logFilePath),
					datePattern: "YYYY-MM-DD",
					maxSize: process.env.LOG_MAX_SIZE || "20m",
					maxFiles: process.env.LOG_MAX_FILES || "14d",
					format: buildFormat("file"),
				}),
			]
		: [
				new winston.transports.Console({
					format: buildFormat("console"),
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
	http: getLogger("HTTP"),
} as const;

// Intercept console.log/warn/error and write to LOG_FILE_PATH
export const interceptConsole = () => {
	const logFilePath = process.env.LOG_FILE_PATH;
	if (!logFilePath) return;

	const consoleLogger = createLogger("console");

	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;

	console.log = (...args: unknown[]) => {
		originalLog(...args);
		consoleLogger.info(args.map(String).join(" "));
	};

	console.warn = (...args: unknown[]) => {
		originalWarn(...args);
		consoleLogger.warn(args.map(String).join(" "));
	};

	console.error = (...args: unknown[]) => {
		originalError(...args);
		consoleLogger.error(args.map(String).join(" "));
	};
};
