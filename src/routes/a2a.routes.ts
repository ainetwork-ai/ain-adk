import { InMemoryTaskStore } from "@a2a-js/sdk/server";
import { Router } from "express";
import type { AINAgent } from "@/index.js";
import { QueryStreamService } from "@/services/query-stream.service.js";
import { A2AController } from "../controllers/a2a.controller.js";
import { A2AService } from "../services/a2a.service.js";

/**
 * Creates and configures the A2A router.
 * This function is a "composition root" for the A2A feature,
 * creating and injecting all necessary dependencies.
 * @param intentAnalyzer The core intent analyzer.
 * @param agentCard The agent's card.
 * @returns An Express Router instance.
 */
export const createA2ARouter = (agent: AINAgent): Router => {
	const router = Router();

	// 1. Create dependencies for the A2A feature
	const taskStore = new InMemoryTaskStore();
	const queryStreamService = new QueryStreamService(
		agent.modelModule,
		agent.a2aModule,
		agent.mcpModule,
		agent.memoryModule,
		agent.manifest.prompts,
	);
	const a2aService = new A2AService(queryStreamService);
	const a2aController = new A2AController(
		a2aService,
		taskStore,
		agent.generateAgentCard,
	);

	// 2. Define the route
	router.post("/", a2aController.handleA2ARequest);

	return router;
};
