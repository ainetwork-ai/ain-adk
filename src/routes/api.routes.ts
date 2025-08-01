import { Router } from "express";
import type { AINAgent } from "@/index.js";

import { createModelApiRouter } from "./api/models.routes.js";
import { createSessionApiRouter } from "./api/sessions.routes.js";

export const createApiRouter = (agent: AINAgent): Router => {
	const router = Router();

	router.use("/api/models", createModelApiRouter(agent.modelModule));
	if (agent.memoryModule) {
		router.use("/api/sessions", createSessionApiRouter(agent.memoryModule));
	}

	return router;
};
