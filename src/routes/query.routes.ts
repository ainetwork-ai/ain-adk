import { Router } from "express";
import { QueryController } from "@/controllers/query.controller.js";
import type { AINAgent } from "@/index.js";
import { QueryService } from "@/services/query.service.js";

export const createQueryRouter = (agent: AINAgent): Router => {
	const router = Router();

	const queryService = new QueryService(
		agent.modelModule,
		agent.a2aModule,
		agent.mcpModule,
		agent.memoryModule,
		agent.intentModule,
		agent.manifest.prompts,
	);
	const queryController = new QueryController(queryService);
	router.post("/query", queryController.handleQueryRequest);

	return router;
};
