import { InMemoryTaskStore } from "@a2a-js/sdk/server";
import { Router } from "express";
import { getAgent } from "@/config/agent";
import { container } from "@/container";
import { A2AController } from "../controllers/a2a.controller.js";

/**
 * Creates and configures the A2A router.
 * This function is a "composition root" for the A2A feature,
 * creating and injecting all necessary dependencies.
 * @returns An Express Router instance.
 */
export const createA2ARouter = (): Router => {
	const router = Router();

	// TaskStore is stateful and needs fresh instance per router
	const taskStore = new InMemoryTaskStore();
	const a2aController = new A2AController(
		container.getA2AService(),
		taskStore,
		getAgent().generateAgentCard,
	);

	router.post("/", a2aController.handleA2ARequest);

	return router;
};
