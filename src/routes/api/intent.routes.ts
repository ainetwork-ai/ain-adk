import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { IntentApiController } from "@/controllers/api/intent.api.controller";
import type { MemoryModule } from "@/modules/index.js";
import { AinHttpError } from "@/types/agent";

export const createIntentApiRouter = (memoryModule: MemoryModule): Router => {
	const router = Router();
	const intentApiController = new IntentApiController(memoryModule);

	const checkThreadMemory = (
		_req: Request,
		_res: Response,
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

	// APIs (prefix: /api/intent)
	router.get("/", checkThreadMemory, intentApiController.handleGetAllIntents);
	router.post("/save", checkThreadMemory, intentApiController.handleSaveIntent);
	router.delete(
		"/:id",
		checkThreadMemory,
		intentApiController.handleDeleteIntent,
	);

	return router;
};
