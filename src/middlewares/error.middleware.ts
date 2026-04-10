import type { NextFunction, Request, Response } from "express";
import type { AinHttpError } from "@/types/agent";
import { logger } from "@/utils/logger";

export const errorMiddleware = (
	error: AinHttpError,
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	try {
		const status: number = error.status || 500;
		const message: string = error.message || "Something went wrong";
		const code: string | undefined = error.code;

		logger.error(
			`[${req.method}] ${req.path} >> StatusCode:: ${status}, Message:: ${message}, Code:: ${code || "UNKNOWN"}`,
		);
		res.status(status).json(code ? { message, code } : { message });
	} catch (error) {
		next(error);
	}
};
