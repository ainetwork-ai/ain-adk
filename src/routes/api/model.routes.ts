import { Router } from "express";
import { container } from "@/container";

export const createModelApiRouter = (): Router => {
	const router = Router();
	const modelApiController = container.getModelApiController();

	// APIs (prefix: /api/model)
	router.get("/", modelApiController.handleModelList);

	return router;
};
