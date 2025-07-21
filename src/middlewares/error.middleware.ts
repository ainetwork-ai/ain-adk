import type { NextFunction, Request, Response } from "express";
import { logger } from "@/utils/logger.js";

export interface HttpException extends Error {
	status?: number;
}

export const errorMiddleware = (
	error: HttpException,
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
