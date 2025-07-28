import type { NextFunction, Request, Response } from "express";
import type { ModelModule } from "@/modules/index.js";

export class ModelApiController {
	private modelModule: ModelModule;

	constructor(modelModule: ModelModule) {
		this.modelModule = modelModule;
	}

	public handleModelList = (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const models = this.modelModule.getModelList();
			res.json(models);
		} catch (error) {
			next(error);
		}
	};
}
