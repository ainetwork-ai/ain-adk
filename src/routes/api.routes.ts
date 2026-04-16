import { Router } from "express";
import { getArtifactModule, getMemoryModule } from "@/config/modules";
import { createAgentApiRouter } from "./api/agent.routes.js";
import { createArtifactApiRouter } from "./api/artifacts.routes.js";
import { createIntentApiRouter } from "./api/intent.routes.js";
import { createModelApiRouter } from "./api/model.routes.js";
import { createThreadApiRouter } from "./api/threads.routes.js";
import { createUserWorkflowApiRouter } from "./api/user-workflow.routes.js";
import { createWorkflowTemplateApiRouter } from "./api/workflow-template.routes.js";

export const createApiRouter = (): Router => {
	const router = Router();

	router.use("/model", createModelApiRouter());
	router.use("/agent", createAgentApiRouter());
	if (getArtifactModule()) {
		router.use("/artifacts", createArtifactApiRouter());
	}

	const memoryModule = getMemoryModule();
	if (memoryModule) {
		router.use("/threads", createThreadApiRouter());
		router.use("/intent", createIntentApiRouter());
		router.use("/workflow-template", createWorkflowTemplateApiRouter());
		router.use("/user-workflow", createUserWorkflowApiRouter());
	}

	return router;
};
