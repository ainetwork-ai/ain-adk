import { Router } from "express";
import type { AINAgent } from "@/index.js";

import { createModelApiRouter } from "./api/model.routes.js";
import { createThreadApiRouter } from "./api/thread.routes.js";

export const createApiRouter = (agent: AINAgent): Router => {
	const router = Router();

	router.use("/api/model", createModelApiRouter(agent.modelModule));
	if (agent.memoryModule) {
		router.use("/api/thread", createThreadApiRouter(agent.memoryModule));
	}

	return router;
};
