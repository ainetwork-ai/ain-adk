import type { ListOptions } from "@/types/list.js";

export const MAX_LIST_LIMIT = 100;

/**
 * Parses `?limit=&offset=` into pagination options.
 *
 * Returns undefined when `limit` is absent or unparseable — the caller then
 * serves the legacy bare-array response. Garbage never 400s: pagination is
 * an opt-in enhancement, not a validation surface.
 */
export function parseListOptions(
	query: Record<string, unknown>,
): Required<ListOptions> | undefined {
	if (typeof query.limit !== "string" || query.limit === "") return undefined;
	const limit = Number(query.limit);
	if (!Number.isFinite(limit)) return undefined;
	const rawOffset = typeof query.offset === "string" ? Number(query.offset) : 0;
	const offset = Number.isFinite(rawOffset)
		? Math.max(0, Math.floor(rawOffset))
		: 0;
	return {
		limit: Math.min(Math.max(1, Math.floor(limit)), MAX_LIST_LIMIT),
		offset,
	};
}
