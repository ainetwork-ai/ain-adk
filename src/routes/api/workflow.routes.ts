import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { getMemoryModule } from "@/config/modules";
import { container } from "@/container";
import { AinHttpError } from "@/types/agent";

export const createWorkflowApiRouter = (): Router => {
	const router = Router();
	const workflowApiController = container.getWorkflowApiController();

	const checkWorkflowMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const workflowMemory = memoryModule.getWorkflowMemory();
		if (!workflowMemory) {
			const error = new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Workflow memory is not initialized",
			);
			throw error;
		}
		next();
	};

	// APIs (prefix: /api/workflow)
	router.get(
		"/",
		checkWorkflowMemory,
		workflowApiController.handleGetAllWorkflows,
	);
	router.get(
		"/:id",
		checkWorkflowMemory,
		workflowApiController.handleGetWorkflow,
	);
	router.post(
		"/",
		checkWorkflowMemory,
		workflowApiController.handleCreateWorkflow,
	);
	router.post(
		"/update/:id",
		checkWorkflowMemory,
		workflowApiController.handleUpdateWorkflow,
	);
	router.post(
		"/delete/:id",
		checkWorkflowMemory,
		workflowApiController.handleDeleteWorkflow,
	);

	return router;
};
