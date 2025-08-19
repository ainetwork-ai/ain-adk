import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";

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
			const { id: threadId } = req.params as {
				id: string;
			};
			const userId = res.locals.userId || "";
			const threadMemory = this.memoryModule.getThreadMemory();
			const thread = await threadMemory?.getThread(userId, threadId);
			res.json(thread);
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteThread = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id: threadId } = req.params;
			const userId = res.locals.userId || "";
			const threadMemory = this.memoryModule.getThreadMemory();
			await threadMemory?.deleteThread(userId, threadId);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleGetUserThreads = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const threadMemory = this.memoryModule.getThreadMemory();
			const threads = await threadMemory?.listThreads(userId);
			res.json(threads);
		} catch (error) {
			next(error);
		}
	};
}
