import type { NextFunction, Request, Response } from "express";
import type { MemoryModule } from "@/modules/index.js";

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
			const memoryInstance = this.memoryModule.getMemory();
			const session = await memoryInstance.getSessionHistory(sessionId);
			res.json(session);
		} catch (error) {
			next(error);
		}
	};
}
