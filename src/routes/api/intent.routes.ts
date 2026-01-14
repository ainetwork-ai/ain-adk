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

export const createIntentApiRouter = (): Router => {
	const router = Router();
	const intentApiController = container.getIntentApiController();

	const checkThreadMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
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
