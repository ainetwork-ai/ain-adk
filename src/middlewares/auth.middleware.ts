import type { NextFunction, Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { BaseAuth } from "@/modules/auth/base.auth";
import { AinHttpError } from "@/types/agent";
import type { AuthResponse } from "@/types/auth";
import { loggers } from "@/utils/logger";

export class AuthMiddleware {
	private auth: BaseAuth;
	constructor(auth: BaseAuth) {
		this.auth = auth;
	}

	public middleware(): RequestHandler {
		return async (req: Request, res: Response, next: NextFunction) => {
			try {
				const authRes: AuthResponse = await this.auth.authenticate(req, res);
				if (authRes.isAuthenticated) {
					res.locals.userId = authRes.userId;
					next();
				} else {
					const error: AinHttpError = new AinHttpError(
						StatusCodes.UNAUTHORIZED,
						"Unauthorized",
					);
					throw error;
				}
			} catch (e: any) {
				if (!e.status) {
					const error: AinHttpError = new AinHttpError(
						StatusCodes.INTERNAL_SERVER_ERROR,
						`Authentication error: ${JSON.stringify(e)}`,
					);
					throw error;
				}
				throw e;
			}
		};
	}
}
