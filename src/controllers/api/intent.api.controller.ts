import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { Intent } from "@/types/memory";

export class IntentApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleGetAllIntents = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const intentMemory = this.memoryModule.getIntentMemory();
			const intents = await intentMemory?.listIntents();
			res.json(intents);
		} catch (error) {
			next(error);
		}
	};

	public handleSaveIntent = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const intent = req.body as Intent;
			const intentMemory = this.memoryModule.getIntentMemory();
			await intentMemory?.saveIntent(intent);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteIntent = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const intentMemory = this.memoryModule.getIntentMemory();
			await intentMemory?.deleteIntent(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};
}
