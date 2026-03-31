import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { getMemoryModule } from "@/config/modules";
import { container } from "@/container";
import { AinHttpError } from "@/types/agent";

export const createScheduledJobApiRouter = (): Router => {
	const router = Router();
	const scheduledJobApiController = container.getScheduledJobApiController();

	const checkScheduledJobMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const scheduledJobMemory = memoryModule.getScheduledJobMemory();
		if (!scheduledJobMemory) {
			const error = new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Scheduled job memory is not initialized",
			);
			throw error;
		}
		next();
	};

	// APIs (prefix: /api/scheduled-job)
	router.get(
		"/",
		checkScheduledJobMemory,
		scheduledJobApiController.handleGetAllJobs,
	);
	router.get(
		"/:id",
		checkScheduledJobMemory,
		scheduledJobApiController.handleGetJob,
	);
	router.post(
		"/",
		checkScheduledJobMemory,
		scheduledJobApiController.handleCreateJob,
	);
	router.post(
		"/update/:id",
		checkScheduledJobMemory,
		scheduledJobApiController.handleUpdateJob,
	);
	router.post(
		"/delete/:id",
		checkScheduledJobMemory,
		scheduledJobApiController.handleDeleteJob,
	);
	router.post(
		"/:id/run",
		checkScheduledJobMemory,
		scheduledJobApiController.handleRunJob,
	);

	return router;
};
