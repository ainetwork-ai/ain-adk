import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { QueryService, QueryStreamService } from "@/services";
import { AinHttpError } from "@/types/agent";

export class QueryController {
	private queryService;
	private queryStreamService;

	constructor(
		queryService: QueryService,
		queryStreamService?: QueryStreamService,
	) {
		this.queryService = queryService;
		this.queryStreamService = queryStreamService;
	}

	public handleQueryRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, message, threadId } = req.body;
		const userId = res.locals.userId;

		try {
			const result = await this.queryService.handleQuery(
				{ type, userId, threadId },
				message,
			);

			res.status(200).json(result);
		} catch (error) {
			next(error);
		}
	};

	public handleQueryStreamRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, threadId, message } = req.body;
		const userId = res.locals.userId;

		if (!this.queryStreamService) {
			const error = new AinHttpError(
				StatusCodes.NOT_IMPLEMENTED,
				"Stream query not supported",
			);
			return next(error);
		}

		const stream = this.queryStreamService.handleQueryStream(
			{ type, userId, threadId },
			message,
		);

		try {
			for await (const event of stream) {
				res.write(
					`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
				);
			}
		} catch (error) {
			res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
		} finally {
			res.end();
		}
	};
}
