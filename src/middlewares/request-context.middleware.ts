import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { loggers } from "@/utils/logger";
import {
	getRequestContext,
	runWithRequestContext,
} from "@/utils/request-context";

const REQUEST_ID_HEADER = "x-request-id";

// Reused only when the client-supplied id is safe to embed in logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Opens an AsyncLocalStorage request context for the whole request chain.
 * Reuses the incoming X-Request-Id when present (so ids can be correlated
 * across services), otherwise generates one, and echoes it in the response.
 * Must be registered before anything that logs.
 */
export const requestContextMiddleware = (): RequestHandler => {
	return (req, res, next) => {
		const incoming = req.header(REQUEST_ID_HEADER)?.trim();
		const requestId =
			incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
		res.setHeader("X-Request-Id", requestId);
		runWithRequestContext({ requestId }, next);
	};
};

// Health checks and agent-card discovery poll these constantly.
const ACCESS_LOG_SKIP_PATHS = new Set([
	"/",
	"/.well-known/agent.json",
	"/.well-known/agent-card.json",
]);

/**
 * Logs one line per completed request (method, path, status, duration) so
 * the log always records the request boundary, even when no service-level
 * log was emitted.
 */
export const accessLogMiddleware = (): RequestHandler => {
	return (req, res, next) => {
		if (ACCESS_LOG_SKIP_PATHS.has(req.path)) return next();
		const start = Date.now();
		// Captured now: the finish event fires from HTTP internals, outside
		// this request's AsyncLocalStorage context.
		const requestId = getRequestContext()?.requestId;
		res.on("finish", () => {
			loggers.http.info("HTTP request", {
				method: req.method,
				path: req.originalUrl,
				status: res.statusCode,
				durationMs: Date.now() - start,
				...(requestId ? { requestId } : {}),
			});
		});
		next();
	};
};
