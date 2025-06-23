import type { AgentCard } from "@a2a-js/sdk";
import cors from "cors";
import express from "express";
import type { IntentAnalyzer } from "@/intent/analyzer.js";
import type { BaseAuth } from "@/middleware/auth/base.js";
import { loggers } from "@/utils/logger.js";
import { A2ARouter } from "./router/a2a/router.js";
import type { AgentInfo } from "./types/index.js";

export class AINAgent {
	public app: express.Application;
	public info: AgentInfo;

	// Modules
	private authScheme?: BaseAuth;
	private intentAnalyzer: IntentAnalyzer;
	private a2aRouter?: A2ARouter;

	constructor(intentAnalyzer: IntentAnalyzer, info: AgentInfo, url?: string) {
		this.app = express();
		this.app.use(cors());
		this.app.use(express.json());

		this.intentAnalyzer = intentAnalyzer;
		this.info = info;
		if (url) {
			// A2A Server enabled
			const card: AgentCard = this.infoToCard(info, url);
			this.a2aRouter = new A2ARouter(intentAnalyzer, card);
		}
	}

	private infoToCard(info: AgentInfo, url: string): AgentCard {
		const _url = new URL(url);
		_url.pathname = "a2a";
		return {
			...info,
			url: _url.toString(),
			capabilities: {
				streaming: true, // The new framework supports streaming
				pushNotifications: false, // Assuming not implemented for this agent yet
				stateTransitionHistory: true, // Agent uses history
			},
			defaultInputModes: ["text"],
			defaultOutputModes: ["text", "task-status"], // task-status is a common output mode
			skills: [],
			supportsAuthenticatedExtendedCard: false,
		};
	}

	public start(port: number): void {
		if (this.authScheme) {
			this.app.use(this.authScheme.middleware());
		}

		this.app.get("/", async (_req, res) => {
			const { name, description, version } = this.info;
			res.status(200).send(
				`
        ⚡ AIN Agent: ${name} v${version}<br/>
        ${description}<br/><br/>
        Agent status: Online and ready.
      `.trim(),
			);
		});

		this.app.post("/query", async (req, res) => {
			const { message } = req.body;

			// TODO: Handle query type
			const response = await this.intentAnalyzer?.handleQuery(message);
			res.json(response);
		});

		this.a2aRouter?.setupRoutes(this.app);

		this.app.listen(port, () => {
			loggers.agent.info(`AINAgent is running on port ${port}`);
		});
	}
}
