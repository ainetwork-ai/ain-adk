import { Router } from "express";
import { getMemoryModule } from "@/config/modules";
import { createAgentApiRouter } from "./api/agent.routes.js";
import { createIntentApiRouter } from "./api/intent.routes.js";
import { createModelApiRouter } from "./api/model.routes.js";
import { createThreadApiRouter } from "./api/threads.routes.js";
import { createWorkflowApiRouter } from "./api/workflow.routes.js";

export const createApiRouter = (): Router => {
	const router = Router();

	router.use("/model", createModelApiRouter());
	router.use("/agent", createAgentApiRouter());

	const memoryModule = getMemoryModule();
	if (memoryModule) {
		router.use("/threads", createThreadApiRouter());
		router.use("/intent", createIntentApiRouter());
		router.use("/workflow", createWorkflowApiRouter());
	}

	return router;
};
