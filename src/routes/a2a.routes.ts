import { InMemoryTaskStore } from "@a2a-js/sdk";
import { Router } from "express";
import type AINAgent from "@/app.js";
import { QueryService } from "@/services/query.service.js";
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
	const queryService = new QueryService(
		agent.modelModule,
		agent.a2aModule,
		agent.mcpModule,
		agent.memoryModule,
	);
	const a2aService = new A2AService(queryService);
	const a2aController = new A2AController(
		a2aService,
		taskStore,
		agent.generateAgentCard,
	);

	// 2. Define the route
	router.post("/a2a", a2aController.handleA2ARequest);

	return router;
};
