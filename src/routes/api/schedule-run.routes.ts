import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { getMemoryModule } from "@/config/modules";
import { AinHttpError } from "@/types/agent";
import type {
	ScheduleJobType,
	ScheduleRunFilter,
	ScheduleRunStatus,
} from "@/types/schedule";

const SCHEDULE_JOB_TYPES: readonly ScheduleJobType[] = [
	"WORKFLOW",
	"SLOT_REFRESH",
];
const SCHEDULE_RUN_STATUSES: readonly ScheduleRunStatus[] = [
	"running",
	"success",
	"failed",
	"skipped_overlap",
];

function parseEnumParam<T extends string>(
	name: string,
	value: unknown,
	allowed: readonly T[],
): T | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			`invalid ${name}: ${String(value)}`,
		);
	}
	return value as T;
}

/**
 * Validates/parses the list query params. Express's qs parser can produce
 * arrays (repeated keys) or nested objects — anything that is not a plain,
 * known enum/string value is rejected with a 400 instead of silently
 * mis-filtering. Absent params stay undefined (no filter). `limit` keeps its
 * lenient clamp: non-numeric → default 20, otherwise clamped to [1, 100].
 */
export function parseScheduleRunListQuery(query: Record<string, unknown>): {
	filter: ScheduleRunFilter;
	limit: number;
} {
	const jobType = parseEnumParam("jobType", query.jobType, SCHEDULE_JOB_TYPES);
	const status = parseEnumParam("status", query.status, SCHEDULE_RUN_STATUSES);
	const jobKey = query.jobKey;
	if (jobKey !== undefined && typeof jobKey !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			`invalid jobKey: ${String(jobKey)}`,
		);
	}
	const parsedLimit =
		typeof query.limit === "string" && query.limit
			? Number.parseInt(query.limit, 10)
			: Number.NaN;
	return {
		filter: { jobType, jobKey, status },
		limit: Number.isFinite(parsedLimit)
			? Math.min(Math.max(parsedLimit, 1), 100)
			: 20,
	};
}

export const createScheduleRunApiRouter = (): Router => {
	const router = Router();

	// APIs (prefix: /api/schedule-runs)
	router.get("/", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const memory = getMemoryModule().getScheduleRunMemory();
			if (!memory) {
				throw new AinHttpError(
					StatusCodes.SERVICE_UNAVAILABLE,
					"Schedule run memory is not initialized",
				);
			}
			const { filter, limit } = parseScheduleRunListQuery(
				req.query as Record<string, unknown>,
			);
			const runs = await memory.listScheduleRuns(filter, limit);
			res.status(StatusCodes.OK).json(runs);
		} catch (error) {
			next(error);
		}
	});

	return router;
};
