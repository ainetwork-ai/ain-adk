import { Router } from "express";
import { container } from "@/container";

export const createAgentApiRouter = (): Router => {
	const router = Router();
	const agentApiController = container.getAgentApiController();

	// APIs (prefix: /api/agent)
	router.get("/a2a", agentApiController.handleGetA2AConnectors);

	return router;
};
