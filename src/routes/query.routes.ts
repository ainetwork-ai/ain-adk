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
		agent.onIntentFallback,
	);

	const queryController = new QueryController(queryService);

	router.post("/", queryController.handleQueryRequest);
	router.post("/stream", queryController.handleQueryStreamRequest);

	return router;
};
