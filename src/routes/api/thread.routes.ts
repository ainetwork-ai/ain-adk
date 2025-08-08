import { Router } from "express";
import { ThreadApiController } from "@/controllers/api/thread.api.controller.js";
import type { MemoryModule } from "@/modules/index.js";

export const createThreadApiRouter = (memoryModule: MemoryModule): Router => {
	const router = Router();
	const threadApiController = new ThreadApiController(memoryModule);

	// APIs (prefix: /api/thread)
	router.get("/:id", threadApiController.handleGetThread);

	return router;
};
