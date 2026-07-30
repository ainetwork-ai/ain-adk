import { inspect } from "node:util";
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

// Error objects passed as meta ({ error }) JSON.stringify to "{}" because
// message/stack are non-enumerable — the log would record nothing. Convert
// them to their stack string (which starts with "Error: <message>").
export const serializeErrorValues = winston.format((info) => {
	for (const key of Object.keys(info)) {
		const value = info[key];
		if (value instanceof Error) {
			info[key] = value.stack ?? `${value.name}: ${value.message}`;
		}
	}
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
			serializeErrorValues(),
			injectRequestContext(),
			timestamp(),
			json(),
		);
	}
	return combine(
		errors({ stack: true }),
		serializeErrorValues(),
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

const formatConsoleArgs = (args: unknown[]): string =>
	args.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" ");

let interceptedConsole: Pick<Console, "log" | "warn" | "error"> | undefined;

// Mirrors console.log/warn/error into the log file so server start/stop
// banners and stray console calls appear in the same .jsonl as everything
// else. Still prints to stdout; no-op without LOG_FILE_PATH (dev console
// stays untouched). Idempotent: only the first call patches.
export const interceptConsole = (): winston.Logger | undefined => {
	const logFilePath = process.env.LOG_FILE_PATH;
	if (!logFilePath || interceptedConsole) return undefined;

	const consoleLogger = createLogger("console");
	interceptedConsole = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	};

	// Re-entrancy guard: winston/transport error handling may itself call
	// console.*; mirroring that would recurse until the stack overflows.
	let mirroring = false;
	const mirror = (write: (text: string) => unknown, args: unknown[]) => {
		if (mirroring) return;
		mirroring = true;
		try {
			write(formatConsoleArgs(args));
		} finally {
			mirroring = false;
		}
	};

	console.log = (...args: unknown[]) => {
		interceptedConsole?.log(...args);
		mirror((text) => consoleLogger.info(text), args);
	};

	console.warn = (...args: unknown[]) => {
		interceptedConsole?.warn(...args);
		mirror((text) => consoleLogger.warn(text), args);
	};

	console.error = (...args: unknown[]) => {
		interceptedConsole?.error(...args);
		mirror((text) => consoleLogger.error(text), args);
	};

	return consoleLogger;
};

// Undoes interceptConsole (used by tests; safe to call unpatched).
export const restoreConsole = (): void => {
	if (!interceptedConsole) return;
	console.log = interceptedConsole.log;
	console.warn = interceptedConsole.warn;
	console.error = interceptedConsole.error;
	interceptedConsole = undefined;
};
