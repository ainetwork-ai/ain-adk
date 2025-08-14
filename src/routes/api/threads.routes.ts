import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { ThreadApiController } from "@/controllers/api/threads.api.controller.js";
import type { MemoryModule } from "@/modules/index.js";
import { AinHttpError } from "@/types/agent";

export const createThreadApiRouter = (memoryModule: MemoryModule): Router => {
	const router = Router();
	const threadApiController = new ThreadApiController(memoryModule);

	const checkThreadMemory = (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const threadMemory = memoryModule.getThreadMemory();
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
