import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { IntentTriggerService } from "@/services";
import type { ThreadService } from "@/services/thread.service";

export class IntentController {
	private threadService: ThreadService;
	private triggerService: IntentTriggerService;

	constructor(
		threadService: ThreadService,
		triggerService: IntentTriggerService,
	) {
		this.threadService = threadService;
		this.triggerService = triggerService;
	}

	public handleIntentTrigger = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { query, threadId } = req.body;
		const userId = res.locals.userId;

		try {
			const thread = await this.threadService.getThread(userId, threadId);
			const result = await this.triggerService.intentTriggering(query, thread);

			res.status(StatusCodes.OK).json(result);
		} catch (error) {
			next(error);
		}
	};
}
