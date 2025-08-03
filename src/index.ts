import type { AgentCard } from "@a2a-js/sdk";
import cors from "cors";
import express, { type Response } from "express";
import helmet from "helmet";
import { StatusCodes } from "http-status-codes";
import { loggers } from "@/utils/logger";
import { AuthMiddleware } from "./middlewares/auth.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import type {
	A2AModule,
	BaseAuth,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "./modules";
import { createA2ARouter, createApiRouter, createQueryRouter } from "./routes";
import type { AinAgentManifest } from "./types/agent";

/**
 * Main class for AI Network Agent Development Kit (AIN-ADK).
 *
 * AINAgent orchestrates all modules and provides an Express server for handling
 * agent interactions through both standard query endpoints and A2A protocol endpoints.
 *
 * @example
 * ```typescript
 * const manifest = {
 *   name: "MyAgent",
 *   description: "An example AI agent",
 *   version: "1.0.0"
 * };
 *
 * const agent = new AINAgent(manifest, {
 *   modelModule: new ModelModule(),
 *   a2aModule: new A2AModule(),
 *   mcpModule: new MCPModule()
 * });
 *
 * agent.start(3000);
 * ```
 */
export class AINAgent {
	/** Express application instance */
	public app: express.Application;

	/** Agent manifest containing metadata and configuration */
	public manifest: AinAgentManifest;

	/** Modules */
	public modelModule: ModelModule;
	public a2aModule?: A2AModule;
	public mcpModule?: MCPModule;
	public memoryModule?: MemoryModule;

	/** Optional authentication scheme for securing endpoints */
	public authScheme?: BaseAuth;

	/**
	 * Creates a new AINAgent instance.
	 *
	 * @param manifest - Agent manifest containing name, description, version, and optional URL
	 * @param modules - Required and optional modules for the agent
	 * @param modules.modelModule - Required module for AI model integrations
	 * @param modules.a2aModule - Optional module for A2A protocol support
	 * @param modules.mcpModule - Optional module for MCP server connections
	 * @param modules.memoryModule - Optional module for memory management
	 * @param modules.folModule - Optional module for fol management
	 * @param authScheme - Optional authentication middleware for securing endpoints
	 */
	constructor(
		manifest: AinAgentManifest,
		modules: {
			modelModule: ModelModule;
			a2aModule?: A2AModule;
			mcpModule?: MCPModule;
			memoryModule?: MemoryModule;
		},
		authScheme?: BaseAuth,
		allowStream = false,
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
		this.initializeRoutes(allowStream);
		this.app.use(errorMiddleware);
	}

	/**
	 * Initializes Express middlewares for security, CORS, and body parsing.
	 * Also applies authentication middleware if configured.
	 */
	private initializeMiddlewares(): void {
		this.app.use(helmet());
		this.app.use(cors());
		this.app.use(express.json());
		this.app.use(express.urlencoded({ extended: true }));

		if (this.authScheme) {
			const auth = new AuthMiddleware(this.authScheme);
			this.app.use(auth.middleware());
		}
	}

	/**
	 * Validates if a string is a valid HTTP or HTTPS URL.
	 *
	 * @param urlString - The URL string to validate
	 * @returns true if the URL is valid HTTP/HTTPS, false otherwise
	 */
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

	/**
	 * Generates an A2A protocol agent card for discovery.
	 *
	 * The agent card contains metadata about the agent's capabilities,
	 * supported input/output modes, and connection information.
	 *
	 * @returns AgentCard object with agent metadata and capabilities
	 * @throws Error if manifest URL is invalid or missing
	 */
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

	/**
	 * Initializes all HTTP routes including health check, agent discovery,
	 * query endpoints, and optional A2A endpoints.
	 *
	 * Routes initialized:
	 * - GET / - Health check endpoint
	 * - GET /.well-known/agent.json - Agent card discovery endpoint
	 * - /query/* - Query processing endpoints
	 * - /a2a/* - A2A protocol endpoints (only if valid URL is configured)
	 */
	private initializeRoutes = (allowStream = false): void => {
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

		this.app.use(createQueryRouter(this, allowStream));
		this.app.use(createApiRouter(this));
		if (this.isValidUrl(this.manifest.url)) {
			this.app.use(createA2ARouter(this));
		}
	};

	/**
	 * Starts the Express server on the specified port.
	 *
	 * @param port - The port number to listen on
	 */
	public async start(port: number): Promise<void> {
		await this.memoryModule?.initialize();
		this.app.listen(port, () => {
			loggers.agent.info(`AINAgent is running on port ${port}`);
		});
	}
}
