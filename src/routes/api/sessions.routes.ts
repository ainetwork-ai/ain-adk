import { Router } from "express";
import { SessionApiController } from "@/controllers/api/session.api.controller.js";
import type { MemoryModule } from "@/modules/index.js";

export const createSessionApiRouter = (memoryModule: MemoryModule): Router => {
	const router = Router();
	const sessionApiController = new SessionApiController(memoryModule);

	// APIs (prefix: /api/sessions)
	router.get("/:id", sessionApiController.handleSessionHistory);

	return router;
};
