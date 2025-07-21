import type { AgentCard } from "@a2a-js/sdk";
import cors from "cors";
import express, { type Response } from "express";
import helmet from "helmet";
import { StatusCodes } from "http-status-codes";
import type { BaseAuth } from "@/middlewares/auth/base.js";
import { loggers } from "@/utils/logger.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "./modules/index.js";
import { createA2ARouter } from "./routes/a2a.routes.js";
import { createQueryRouter } from "./routes/query.routes.js";
import type { AinAgentManifest } from "./types/index.js";

export default class AINAgent {
	public app: express.Application;
	public manifest: AinAgentManifest;

	// Modules
	public modelModule: ModelModule;
	public a2aModule?: A2AModule;
	public mcpModule?: MCPModule;
	public memoryModule?: MemoryModule;

	public authScheme?: BaseAuth;

	constructor(
		manifest: AinAgentManifest,
		modules: {
			modelModule: ModelModule;
			a2aModule?: A2AModule;
			mcpModule?: MCPModule;
			memoryModule?: MemoryModule;
		},
		authScheme?: BaseAuth,
	) {
		this.app = express();

		// Set manifest
		this.manifest = manifest;

		// Set modules
		this.modelModule = modules.modelModule;
		this.a2aModule = modules.a2aModule;
		this.mcpModule = modules.mcpModule;
		this.memoryModule = modules.memoryModule;

		this.authScheme = authScheme;

		this.initializeMiddlewares();
		this.initializeRoutes();
		this.app.use(errorMiddleware);
	}

	private initializeMiddlewares(): void {
		this.app.use(helmet());
		this.app.use(cors());
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: true }));

		if (this.authScheme) {
			this.app.use(this.authScheme.middleware());
		}
	}

	private isValidUrl(urlString: string | undefined): boolean {
		if (!urlString) {
			return false;
		}

		try {
			const url = new URL(urlString);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch (_error) {
			return false;
		}
	}

	public generateAgentCard = (): AgentCard => {
		const _url = new URL(this.manifest.url || "");
		_url.pathname = "a2a";

		return {
			name: this.manifest.name,
			description: this.manifest.description,
			version: this.manifest.version,
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
	};

	private initializeRoutes = (): void => {
		this.app.get("/", async (_, res: Response) => {
			const { name, description, version } = this.manifest;
			res.status(200).send(
				`
        ⚡ AIN Agent: ${name} v${version}<br/>
        ${description}<br/><br/>
        Agent status: Online and ready.
      `.trim(),
			);
		});

		this.app.get("/.well-known/agent.json", async (_, res: Response) => {
			try {
				const card = this.generateAgentCard();
				res.json(card);
			} catch (_error) {
				res.status(StatusCodes.NOT_FOUND).send("No agent card");
			}
		});

		this.app.use(createQueryRouter(this));
		if (this.isValidUrl(this.manifest.url)) {
			this.app.use(createA2ARouter(this));
		}
	};

	public start(port: number): void {
		this.app.listen(port, () => {
			loggers.agent.info(`AINAgent is running on port ${port}`);
		});
	}
}
