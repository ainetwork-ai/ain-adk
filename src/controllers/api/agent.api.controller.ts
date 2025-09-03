import type { NextFunction, Request, Response } from "express";
import type { AINAgent } from "@/index";

export class AgentApiController {
	private agent: AINAgent;

	constructor(agent: AINAgent) {
		this.agent = agent;
	}

	public handleGetA2AConnectors = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const a2aModule = this.agent.a2aModule;
			const conns = a2aModule ? a2aModule.getA2AConnectors() : [];
			res.json(conns);
		} catch (error) {
			next(error);
		}
	};
}
