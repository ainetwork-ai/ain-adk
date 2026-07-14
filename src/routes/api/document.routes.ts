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

export const createDocumentApiRouter = (): Router => {
	const router = Router();
	const controller = container.getDocumentApiController();

	const checkDocumentMemory = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		const memoryModule = getMemoryModule();
		const documentMemory = memoryModule.getDocumentMemory();
		if (!documentMemory) {
			throw new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Document memory is not initialized",
			);
		}
		next();
	};

	// APIs (prefix: /api/document)
	router.get("/", checkDocumentMemory, controller.handleGetAllDocuments);
	router.get("/:id", checkDocumentMemory, controller.handleGetDocument);
	router.post("/", checkDocumentMemory, controller.handleCreateDocument);
	router.post(
		"/:id/slots/:slotId/fill",
		checkDocumentMemory,
		controller.handleFillSlot,
	);
	router.post(
		"/:id/slots/:slotId/fill/stream",
		checkDocumentMemory,
		controller.handleFillSlotStream,
	);
	router.post(
		"/:id/slots/:slotId/variables",
		checkDocumentMemory,
		controller.handleUpdateSlotVariables,
	);
	router.post(
		"/:id/advice/stream",
		checkDocumentMemory,
		controller.handleGenerateAdviceStream,
	);
	router.post(
		"/update/:id",
		checkDocumentMemory,
		controller.handleUpdateDocument,
	);
	router.post(
		"/delete/:id",
		checkDocumentMemory,
		controller.handleDeleteDocument,
	);

	return router;
};
