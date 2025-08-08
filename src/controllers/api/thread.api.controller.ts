import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
import type { ThreadType } from "@/types/memory";

export class ThreadApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleGetThread = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id: threadId, type } = req.params as {
				id: string;
				type: ThreadType;
			};
			const userId = res.locals.userId || "";
			const threadMemory = this.memoryModule.getThreadMemory();
			if (!threadMemory) {
				const error = new AinHttpError(
					StatusCodes.SERVICE_UNAVAILABLE,
					"Memory module is not initialized",
				);
				throw error;
			}
			const thread = await threadMemory.getThread(type, userId, threadId);
			res.json(thread);
		} catch (error) {
			next(error);
		}
	};
}
