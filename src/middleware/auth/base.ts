import type { NextFunction, Request, RequestHandler, Response } from "express";

export class BaseAuth {
	public middleware(): RequestHandler {
		return (_req: Request, _res: Response, next: NextFunction) => {
			// Default middleware does nothing
			next();
		};
	}
}
