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
		const { message, threadId } = req.body;
		const userId = res.locals.userId;

		try {
			const result = await this.queryService.handleQuery(
				message,
				threadId,
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
		const { message, threadId } = req.body;
		const userId = res.locals.userId;

		if (!this.queryStreamService) {
			throw new Error("This Agent does not support stream query");
		}

		try {
			await this.queryStreamService.handleQueryStream(
				message,
				userId,
				res,
				threadId,
			);
		} catch (error) {
			next(error);
		}
	};
}
