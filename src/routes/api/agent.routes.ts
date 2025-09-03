import { Router } from "express";
import { AgentApiController } from "@/controllers/api/agent.api.controller";
import type { AINAgent } from "@/index.js";

export const createAgentApiRouter = (agent: AINAgent): Router => {
	const router = Router();
	const agentApiController = new AgentApiController(agent);

	// APIs (prefix: /api/agent)
	router.get("/a2a", agentApiController.handleGetA2AConnectors);

	return router;
};
