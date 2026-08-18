import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient per-request context carried across async boundaries via
 * AsyncLocalStorage. Loggers read from it so every log line can be
 * correlated to a request without threading IDs through parameters.
 */
export interface RequestContext {
	/** Correlation ID: one per HTTP request (or per scheduled run). */
	requestId: string;
	userId?: string;
	threadId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` as the ambient request context. Everything in
 * the async call tree of `fn` (awaits, promises, timers) sees the context.
 */
export const runWithRequestContext = <T>(
	context: RequestContext,
	fn: () => T,
): T => storage.run(context, fn);

/** Returns the ambient context, or undefined outside of one. */
export const getRequestContext = (): RequestContext | undefined =>
	storage.getStore();

/**
 * Merges fields into the current context (e.g. userId after auth,
 * threadId once resolved). No-op when called outside of a context.
 */
export const updateRequestContext = (
	patch: Partial<Omit<RequestContext, "requestId">>,
): void => {
	const store = storage.getStore();
	if (store) Object.assign(store, patch);
};
