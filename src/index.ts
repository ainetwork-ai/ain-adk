import type { AgentCard } from "@a2a-js/sdk";
import cors from "cors";
import express, { type Response } from "express";
import helmet from "helmet";
import { StatusCodes } from "http-status-codes";
import { version } from "../package.json";
import { setManifest } from "./config/manifest";
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
import { createIntentRouter } from "./routes/intent.routes";
import type { AinAgentManifest } from "./types/agent";
import isValidUrl from "./utils/isValidUrl";

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
	public authScheme: BaseAuth;

	/**
	 * Creates a new AINAgent instance.
	 *
	 * @param manifest - Agent manifest containing name, description, version, and optional URL
	 * @param modules - Required and optional modules for the agent
	 * @param modules.modelModule - Required module for AI model integrations
	 * @param modules.a2aModule - Optional module for A2A protocol support
	 * @param modules.mcpModule - Optional module for MCP server connections
	 * @param modules.memoryModule - Optional module for memory management
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
		authScheme: BaseAuth,
	) {
		this.app = express();

		// Set manifest
		this.manifest = manifest;
		setManifest(manifest);

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

	/**
	 * Initializes Express middlewares for security, CORS, and body parsing.
	 * Also applies authentication middleware if configured.
	 */
	private initializeMiddlewares(): void {
		this.app.use(helmet());
		this.app.use(cors());
		this.app.use(express.json({ limit: "25mb" }));
		this.app.use(express.urlencoded({ limit: "25mb", extended: true }));
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
			version: version,
			protocolVersion: "0.3.0",
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
	 * - /api/* - API endpoints for agent management
	 * - /a2a/* - A2A protocol endpoints (only if valid URL is configured)
	 */
	private initializeRoutes = (): void => {
		const auth = new AuthMiddleware(this.authScheme);

		this.app.get("/", async (_, res: Response) => {
			const { name, description } = this.manifest;
			res.status(200).send(
				`
        ⚡ AIN Agent: ${name} with ain-adk v${version}<br/>
        ${description}<br/><br/>
        Agent status: Online and ready.
      `.trim(),
			);
		});

		this.app.get(
			[
				"/.well-known/agent.json", // ~v0.2.0
				"/.well-known/agent-card.json", // v0.3.0~
			],
			async (_, res: Response) => {
				try {
					const card = this.generateAgentCard();
					res.json(card);
				} catch (_error) {
					res.status(StatusCodes.NOT_FOUND).send("No agent card");
				}
			},
		);

		this.app.use("/query", auth.middleware(), createQueryRouter(this));
		this.app.use("/intent", auth.middleware(), createIntentRouter(this));
		this.app.use("/api", auth.middleware(), createApiRouter(this));

		if (isValidUrl(this.manifest.url)) {
			this.app.use("/a2a", createA2ARouter(this));
		}
	};

	/**
	 * Starts the Express server on the specified port.
	 *
	 * @param port - The port number to listen on
	 */
	public async start(port: number): Promise<void> {
		const server = this.app.listen(port, async () => {
			await this.memoryModule?.initialize();
			await this.mcpModule?.connectToServers();
			console.log(`AINAgent is running on port ${port}`);
		});

		// Graceful shutdown handling
		const gracefulShutdown = async (signal: string) => {
			console.log(`Received ${signal}, starting graceful shutdown...`);

			// Stop accepting new connections
			server.close(() => {
				console.log("HTTP server closed");
			});

			try {
				// Cleanup modules
				if (this.mcpModule) {
					console.log("Disconnecting from MCP servers...");
					await this.mcpModule.cleanup();
				}

				if (this.memoryModule) {
					console.log("Closing memory module...");
					await this.memoryModule.shutdown();
				}

				console.log("Graceful shutdown completed");
				process.exit(0);
			} catch (error) {
				console.error("Error during graceful shutdown:", error);
				process.exit(1);
			}
		};

		// Register signal handlers
		process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
		process.on("SIGINT", () => gracefulShutdown("SIGINT"));
		process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
	}
}
