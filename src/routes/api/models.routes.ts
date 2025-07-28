import { Router } from "express";
import { ModelApiController } from "@/controllers/api/model.api.controller.js";
import type { ModelModule } from "@/modules/index.js";

export const createModelApiRouter = (modelModule: ModelModule): Router => {
	const router = Router();
	const modelApiController = new ModelApiController(modelModule);

	// APIs (prefix: /api/models)
	router.get("/", modelApiController.handleModelList);

	return router;
};
