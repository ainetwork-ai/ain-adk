import type { NextFunction, Request, Response } from "express";
import type { AinHttpError } from "@/types";
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

		logger.error(
			`[${req.method}] ${req.path} >> StatusCode:: ${status}, Message:: ${message}`,
		);
		res.status(status).json({ message });
	} catch (error) {
		next(error);
	}
};
