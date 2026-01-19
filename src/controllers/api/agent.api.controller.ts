import type { NextFunction, Request, Response } from "express";
import type { A2AModule } from "@/modules";

export class AgentApiController {
	private a2aModule?: A2AModule;

	constructor(a2aModule?: A2AModule) {
		this.a2aModule = a2aModule;
	}

	public handleGetA2AConnectors = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const conns = this.a2aModule ? this.a2aModule.getA2AConnectors() : [];
			res.json(conns);
		} catch (error) {
			next(error);
		}
	};
}
