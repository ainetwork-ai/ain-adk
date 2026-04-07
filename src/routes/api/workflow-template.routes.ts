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

export const createWorkflowTemplateApiRouter = (): Router => {
	const router = Router();
	const controller = container.getWorkflowTemplateApiController();

	const checkTemplateMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const templateMemory = memoryModule.getWorkflowTemplateMemory();
		if (!templateMemory) {
			const error = new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Workflow template memory is not initialized",
			);
			throw error;
		}
		next();
	};

	// APIs (prefix: /api/workflow-template)
	router.get("/", checkTemplateMemory, controller.handleGetAllTemplates);
	router.get("/:id", checkTemplateMemory, controller.handleGetTemplate);
	router.post("/", checkTemplateMemory, controller.handleCreateTemplate);
	router.post(
		"/update/:id",
		checkTemplateMemory,
		controller.handleUpdateTemplate,
	);
	router.post(
		"/delete/:id",
		checkTemplateMemory,
		controller.handleDeleteTemplate,
	);

	return router;
};
