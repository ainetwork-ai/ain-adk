import { Router } from "express";
import { container } from "@/container";

export const createIntentRouter = (): Router => {
	const router = Router();

	const intentController = container.getIntentController();

	router.post("/trigger", intentController.handleIntentTrigger);

	return router;
};
