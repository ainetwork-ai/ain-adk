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

export const createUserWorkflowApiRouter = (): Router => {
	const router = Router();
	const controller = container.getUserWorkflowApiController();

	const checkUserWorkflowMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const userWorkflowMemory = memoryModule.getUserWorkflowMemory();
		if (!userWorkflowMemory) {
			const error = new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"User workflow memory is not initialized",
			);
			throw error;
		}
		next();
	};

	// APIs (prefix: /api/user-workflow)
	router.get("/", checkUserWorkflowMemory, controller.handleGetAllWorkflows);
	router.get("/:id", checkUserWorkflowMemory, controller.handleGetWorkflow);
	router.post("/", checkUserWorkflowMemory, controller.handleCreateWorkflow);
	router.post(
		"/update/:id",
		checkUserWorkflowMemory,
		controller.handleUpdateWorkflow,
	);
	router.post(
		"/delete/:id",
		checkUserWorkflowMemory,
		controller.handleDeleteWorkflow,
	);
	router.post(
		"/:id/run",
		checkUserWorkflowMemory,
		controller.handleRunWorkflow,
	);

	return router;
};
