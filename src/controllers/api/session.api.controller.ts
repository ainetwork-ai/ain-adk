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
			const userId = res.locals.userId;
			if (!userId) {
				const error = new AinHttpError(
					StatusCodes.UNAUTHORIZED,
					"User ID is required",
				);
				throw error;
			}

			const sessionMemory = this.memoryModule.getSessionMemory();
			if (!sessionMemory) {
				const error = new AinHttpError(
					StatusCodes.SERVICE_UNAVAILABLE,
					"Memory module is not initialized",
				);
				throw error;
			}
			const session = await sessionMemory.getSession(userId, sessionId);
			res.json(session);
		} catch (error) {
			next(error);
		}
	};

	public handleUserSessionList = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId;
			if (!userId) {
				const error = new AinHttpError(
					StatusCodes.UNAUTHORIZED,
					"User ID is required",
				);
				throw error;
			}

			const sessionMemory = this.memoryModule.getSessionMemory();
			if (!sessionMemory) {
				const error = new AinHttpError(
					StatusCodes.SERVICE_UNAVAILABLE,
					"Memory module is not initialized",
				);
				throw error;
			}
			const sessions = await sessionMemory.listSessions(userId);
			res.json(sessions);
		} catch (error) {
			next(error);
		}
	};
}
