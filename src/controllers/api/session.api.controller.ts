import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
export class SessionApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleSessionHistory = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id: sessionId } = req.params;
			const sessionMemory = this.memoryModule.getSessionMemory();
			if (!sessionMemory) {
				const error = new AinHttpError(
					StatusCodes.SERVICE_UNAVAILABLE,
					"Memory module is not initialized",
				);
				throw error;
			}
			const session = await sessionMemory.getSession(sessionId);
			res.json(session);
		} catch (error) {
			next(error);
		}
	};
}
