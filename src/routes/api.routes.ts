import { Router } from "express";
import type { AINAgent } from "@/index.js";
import { createAgentApiRouter } from "./api/agent.routes.js";
import { createIntentApiRouter } from "./api/intent.routes.js";
import { createModelApiRouter } from "./api/model.routes.js";
import { createThreadApiRouter } from "./api/threads.routes.js";

export const createApiRouter = (agent: AINAgent): Router => {
	const router = Router();

	router.use("/model", createModelApiRouter(agent.modelModule));
	router.use("/agent", createAgentApiRouter(agent));
	if (agent.memoryModule) {
		router.use("/threads", createThreadApiRouter(agent.memoryModule));
		router.use("/intent", createIntentApiRouter(agent.memoryModule));
	}

	return router;
};
