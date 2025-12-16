import { Router } from "express";
import { IntentController } from "@/controllers/intent.controller";
import type { AINAgent } from "@/index.js";
import { IntentTriggerService } from "@/services";
import { ThreadService } from "@/services/thread.service";

export const createIntentRouter = (agent: AINAgent): Router => {
	const router = Router();

	const threadService = new ThreadService(agent.memoryModule);
	const triggerService = new IntentTriggerService(
		agent.modelModule,
		agent.memoryModule,
	);

	const intentController = new IntentController(threadService, triggerService);

	router.post("/trigger", intentController.handleIntentTrigger);

	return router;
};
