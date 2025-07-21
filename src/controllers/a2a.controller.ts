import type {
	A2AResponse,
	AgentCard,
	AgentExecutor,
	ExecutionEventBusManager,
	JSONRPCErrorResponse,
	JSONRPCSuccessResponse,
	TaskStore,
} from "@a2a-js/sdk";
import {
	A2AError,
	DefaultExecutionEventBusManager,
	DefaultRequestHandler,
	JsonRpcTransportHandler,
} from "@a2a-js/sdk";
import type { Request, Response } from "express";
import type { A2AService } from "@/services/a2a.service.js";
import { loggers } from "@/utils/logger.js";

/**
 * Handles the transport layer for A2A communication.
 * It orchestrates the A2A-JS SDK components and manages the HTTP request/response lifecycle.
 */

class AINRequestHandler extends DefaultRequestHandler {
	private cardGenerator: () => AgentCard;

	constructor(
		cardGenerator: () => AgentCard,
		taskStore: TaskStore,
		executor: AgentExecutor,
		eventBusManager: ExecutionEventBusManager = new DefaultExecutionEventBusManager(),
	) {
		const card = cardGenerator();
		super(card, taskStore, executor, eventBusManager);
		this.cardGenerator = cardGenerator;
	}

	async getAgentCard(): Promise<AgentCard> {
		return this.cardGenerator();
	}
}

export class A2AController {
	private jsonRpcTransportHandler: JsonRpcTransportHandler;

	constructor(
		a2aService: A2AService,
		taskStore: TaskStore,
		cardGenerator: () => AgentCard,
	) {
		// The controller is responsible for setting up the SDK components.
		const requestHandler = new AINRequestHandler(
			cardGenerator,
			taskStore,
			a2aService, // Injecting the service here as the executor
		);
		this.jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
	}

	/**
	 * Handles the POST /a2a request.
	 */
	public handleA2ARequest = async (req: Request, res: Response) => {
		try {
			const rpcResponseOrStream = await this.jsonRpcTransportHandler.handle(
				req.body,
			);

			// Handle streaming responses (AsyncGenerator)
			if (
				typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] ===
				"function"
			) {
				const stream = rpcResponseOrStream as AsyncGenerator<
					JSONRPCSuccessResponse,
					void,
					undefined
				>;
				this.streamSse(req, res, stream);
			} else {
				// Handle single JSON-RPC response
				const rpcResponse = rpcResponseOrStream as A2AResponse;
				res.status(200).json(rpcResponse);
			}
		} catch (error: unknown) {
			this.handleError(req, res, error);
		}
	};

	private async streamSse(
		req: Request,
		res: Response,
		stream: AsyncGenerator<JSONRPCSuccessResponse, void, undefined>,
	) {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		try {
			for await (const event of stream) {
				res.write(`id: ${Date.now()}\n`);
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			}
		} catch (streamError: unknown) {
			loggers.server.error(
				`Error during SSE streaming (request ${req.body?.id}):`,
				streamError,
			);
			const a2aError =
				streamError instanceof A2AError
					? streamError
					: A2AError.internalError("Streaming error");
			const errorResponse: JSONRPCErrorResponse = {
				jsonrpc: "2.0",
				id: req.body?.id || null,
				error: a2aError.toJSONRPCError(),
			};
			res.write(`id: ${Date.now()}\n`);
			res.write("event: error\n");
			res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
		} finally {
			if (!res.writableEnded) {
				res.end();
			}
		}
	}

	private handleError(req: Request, res: Response, error: unknown) {
		loggers.server.error(
			"Unhandled error in AINAgent A2A POST handler:",
			error,
		);
		const a2aError =
			error instanceof A2AError
				? error
				: A2AError.internalError("General processing error");
		const errorResponse: JSONRPCErrorResponse = {
			jsonrpc: "2.0",
			id: req.body?.id || null,
			error: a2aError.toJSONRPCError(),
		};
		if (!res.headersSent) {
			res.status(500).json(errorResponse);
		} else if (!res.writableEnded) {
			res.end();
		}
	}
}
