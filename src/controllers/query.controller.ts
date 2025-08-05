import type { NextFunction, Request, Response } from "express";
import type { QueryService, QueryStreamService } from "@/services";

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
		try {
			const { message, sessionId } = req.body;
			const userId = res.locals.userId;

			const result = await this.queryService.handleQuery(
				message,
				sessionId,
				userId,
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
		const { message, sessionId, userId } = req.body;

		if (!this.queryStreamService) {
			throw new Error("This Agent does not support stream query");
		}
		try {
			await this.queryStreamService.handleQueryStream(
				message,
				userId,
				res,
				sessionId,
			);
		} catch (error) {
			next(error);
		}
	};
}
