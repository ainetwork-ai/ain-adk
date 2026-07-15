import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { getMemoryModule } from "@/config/modules";
import { AinHttpError } from "@/types/agent";
import type { ScheduleJobType, ScheduleRunStatus } from "@/types/schedule";

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
			const { jobType, jobKey, status, limit } = req.query as Record<
				string,
				string | undefined
			>;
			const parsedLimit = limit ? Number.parseInt(limit, 10) : Number.NaN;
			const runs = await memory.listScheduleRuns(
				{
					jobType: jobType as ScheduleJobType | undefined,
					jobKey,
					status: status as ScheduleRunStatus | undefined,
				},
				Number.isFinite(parsedLimit)
					? Math.min(Math.max(parsedLimit, 1), 100)
					: 20,
			);
			res.status(StatusCodes.OK).json(runs);
		} catch (error) {
			next(error);
		}
	});

	return router;
};
