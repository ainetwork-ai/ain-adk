import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { StatusCodes } from "http-status-codes";
import { getArtifactModule } from "@/config/modules";
import { container } from "@/container";
import { AinHttpError } from "@/types/agent";

export const createArtifactApiRouter = (): Router => {
	const router = Router();
	const artifactApiController = container.getArtifactApiController();

	const checkArtifactModule = (
		_req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		if (!getArtifactModule()) {
			throw new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Artifact module is not initialized",
				"ARTIFACT_STORE_NOT_CONFIGURED",
			);
		}
		next();
	};

	// APIs (prefix: /api/artifacts)
	router.get(
		"/:id",
		checkArtifactModule,
		artifactApiController.handleGetArtifact,
	);
	router.get(
		"/:id/download",
		checkArtifactModule,
		artifactApiController.handleDownloadArtifact,
	);

	return router;
};
