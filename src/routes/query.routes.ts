import { Router } from "express";
import { container } from "@/container";

export const createQueryRouter = (): Router => {
	const router = Router();

	const queryController = container.getQueryController();

	router.post("/", queryController.handleQueryRequest);
	router.post("/stream", queryController.handleQueryStreamRequest);

	return router;
};
