import type { NextFunction, Request, Response } from "express";
import type { QueryService } from "@/services";

export class QueryController {
	private queryService;

	constructor(queryService: QueryService) {
		this.queryService = queryService;
	}

	public handleQueryRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { message, sessionId } = req.body;

			const result = await this.queryService.handleQuery(message, sessionId);

			res.status(200).json(result);
		} catch (error) {
			next(error);
		}
	};
}
