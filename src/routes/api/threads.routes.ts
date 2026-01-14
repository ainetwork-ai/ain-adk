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

export const createThreadApiRouter = (): Router => {
	const router = Router();
	const threadApiController = container.getThreadApiController();

	const checkThreadMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const threadMemory = memoryModule?.getThreadMemory();
		if (!threadMemory) {
			const error = new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Memory module is not initialized",
			);
			throw error;
		}
		next();
	};

	// APIs (prefix: /api/threads)
	router.get("/", checkThreadMemory, threadApiController.handleGetUserThreads);
	router.get("/:id", checkThreadMemory, threadApiController.handleGetThread);
	router.delete(
		"/:id",
		checkThreadMemory,
		threadApiController.handleDeleteThread,
	);

	return router;
};
