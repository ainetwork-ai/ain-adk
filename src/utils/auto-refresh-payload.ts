import type { DocumentAutoRefresh } from "@/types/document";

/**
 * Parses/validates the auto-refresh endpoint body. Returns null when the
 * client is clearing the schedule. Progress fields (doneSlotIds,
 * completedAt) are server-owned: (re)setting a schedule resets progress.
 * Throws a plain Error with a user-readable message on invalid input.
 */
export function parseAutoRefreshPayload(
	body: unknown,
): DocumentAutoRefresh | null {
	if (body === null || body === undefined) return null;
	const raw = body as Record<string, unknown>;
	const value = raw.autoRefresh;
	if (value === null || value === undefined) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error("autoRefresh must be an object or null");
	}
	const v = value as Record<string, unknown>;
	if (typeof v.runAt !== "number" || !Number.isFinite(v.runAt)) {
		throw new Error("autoRefresh.runAt must be a finite epoch-ms number");
	}
	if (typeof v.active !== "boolean") {
		throw new Error("autoRefresh.active must be a boolean");
	}
	if (
		v.slotIds !== undefined &&
		(!Array.isArray(v.slotIds) ||
			v.slotIds.some((slotId) => typeof slotId !== "string"))
	) {
		throw new Error("autoRefresh.slotIds must be an array of strings");
	}
	return {
		runAt: v.runAt,
		active: v.active,
		slotIds: v.slotIds as string[] | undefined,
	};
}
