import cors from "cors";
import express from "express";
import type { IntentAnalyzer } from "@/intent/analyzer.js";
import type { BaseAuth } from "@/server/auth/base.js";
import { loggers } from "@/utils/logger.js";
import { A2AServer } from "./server/a2a/server.js";

export class AINAgent {
	public app: express.Application;

	// Modules
	private authScheme?: BaseAuth;
	private intentAnalyzer: IntentAnalyzer;
	private a2aServer?: A2AServer;

	constructor(intentAnalyzer: IntentAnalyzer, isA2AServer = false) {
		this.app = express();
		this.app.use(cors());
		this.app.use(express.json());

		this.intentAnalyzer = intentAnalyzer;
		if (isA2AServer) {
			this.a2aServer = new A2AServer(intentAnalyzer);
		}
	}

	public start(port: number): void {
		if (this.authScheme) {
			this.app.use(this.authScheme.middleware());
		}

		this.app.get("/", (_req, res) => {
			res.send("Welcome to AINAgent!");
		});

		this.app.post("/query", async (req, res) => {
			const { message } = req.body;

			// TODO: Handle query type
			const response = await this.intentAnalyzer?.handleQuery(message);
			res.json(response);
		});

		this.a2aServer?.setupRoutes(this.app);

		this.app.listen(port, () => {
			loggers.agent.info(`AINAgent is running on port ${port}`);
		});
	}
}
