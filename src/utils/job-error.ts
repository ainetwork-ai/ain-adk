/**
 * Classifies an error thrown by a scheduled job (LLM/agent call) so the
 * JobRunner can decide whether to retry and whether to apply a global
 * rate-limit cooldown. Unknown errors default to non-retryable to avoid
 * wasting retries on deterministic failures (bad definition, missing doc).
 */

const RETRYABLE_CODES = new Set([
	"ECONNRESET",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"EPIPE",
	"EAI_AGAIN",
]);

export interface JobErrorClassification {
	retryable: boolean;
	rateLimited: boolean;
	/** From a Retry-After header when present (ms). */
	retryAfterMs?: number;
}

function extractStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const e = error as {
		status?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
	};
	if (typeof e.status === "number") return e.status;
	if (typeof e.statusCode === "number") return e.statusCode;
	if (typeof e.response?.status === "number") return e.response.status;
	return undefined;
}

function readHeader(headers: unknown, name: string): string | undefined {
	if (!headers) return undefined;
	if (typeof (headers as { get?: unknown }).get === "function") {
		const value = (headers as { get: (n: string) => unknown }).get(name);
		return typeof value === "string" ? value : undefined;
	}
	if (typeof headers === "object") {
		const value = (headers as Record<string, unknown>)[name];
		return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const e = error as { headers?: unknown; response?: { headers?: unknown } };
	const raw =
		readHeader(e.headers, "retry-after") ??
		readHeader(e.response?.headers, "retry-after");
	if (!raw) return undefined;
	const seconds = Number.parseInt(raw, 10);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export function classifyJobError(error: unknown): JobErrorClassification {
	const status = extractStatus(error);
	if (status === 429) {
		return {
			retryable: true,
			rateLimited: true,
			retryAfterMs: extractRetryAfterMs(error),
		};
	}
	if (status !== undefined) {
		return { retryable: status >= 500, rateLimited: false };
	}

	const code = (error as { code?: unknown } | undefined)?.code;
	if (typeof code === "string" && RETRYABLE_CODES.has(code)) {
		return { retryable: true, rateLimited: false };
	}

	const message = error instanceof Error ? error.message : String(error ?? "");
	if (/\b429\b|rate limit/i.test(message)) {
		return { retryable: true, rateLimited: true };
	}
	if (/timeout|timed out/i.test(message)) {
		return { retryable: true, rateLimited: false };
	}
	return { retryable: false, rateLimited: false };
}
