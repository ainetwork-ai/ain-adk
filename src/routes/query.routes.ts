import { Router } from "express";
import { QueryController } from "@/controllers/query.controller.js";
import type { AINAgent } from "@/index.js";
import { QueryService } from "@/services/query.service.js";
import { QueryStreamService } from "@/services/query-stream.service.js";

export const createQueryRouter = (
	agent: AINAgent,
	allowStream = false,
): Router => {
	const router = Router();

	const queryService = new QueryService(
		agent.modelModule,
		agent.a2aModule,
		agent.mcpModule,
		agent.memoryModule,
	);

	let queryStreamService: QueryStreamService | undefined;

	if (allowStream) {
		queryStreamService = new QueryStreamService(
			agent.modelModule,
			agent.a2aModule,
			agent.mcpModule,
			agent.memoryModule,
		);
	}

	const queryController = new QueryController(queryService, queryStreamService);
	router.post("/", queryController.handleQueryRequest);

	if (allowStream) {
		router.post("/stream", queryController.handleQueryStreamRequest);
	}

	return router;
};
