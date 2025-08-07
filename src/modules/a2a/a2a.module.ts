import { randomUUID } from "node:crypto";
import type {
	AgentCard,
	Message,
	MessageSendParams,
	Task,
	TaskStatusUpdateEvent,
	TextPart,
} from "@a2a-js/sdk";
import { A2AClient } from "@a2a-js/sdk/client";
import { loggers } from "@/utils/logger.js";
import { A2ATool } from "./a2a.tool.js";

/**
 * Represents an active A2A communication session.
 */
interface A2ASession {
	/** Current task ID for multi-turn conversations */
	taskId: string | undefined;
	/** Context ID for maintaining conversation state */
	contextId: string | undefined;
}

/**
 * Module for managing Agent-to-Agent (A2A) protocol connections.
 *
 * This module handles connections to other A2A-compatible agents, manages
 * conversation sessions, and provides an interface for inter-agent communication.
 * Supports multi-turn conversations with task and context tracking.
 *
 * @example
 * ```typescript
 * const a2aModule = new A2AModule();
 * await a2aModule.addA2APeerServer("https://api.example.com/agent");
 *
 * const tools = await a2aModule.getTools();
 * const message = a2aModule.getMessagePayload("Hello", "session-123");
 * const response = await a2aModule.useTool(tools[0], message, "session-123");
 * ```
 */
export class A2AModule {
	/** Map of A2A server URLs to their corresponding tool instances */
	private a2aPeerServers: Map<string, A2ATool | null> = new Map();
	/** Map of session IDs to their A2A session state */
	private a2aSessions: Map<string, A2ASession> = new Map();

	/**
	 * Registers a new A2A peer server URL for connection.
	 *
	 * @param url - The URL of the A2A-compatible agent to connect to
	 */
	public async addA2APeerServer(url: string): Promise<void> {
		this.a2aPeerServers.set(url, null);
	}

	/**
	 * Retrieves tools from all registered A2A peer servers.
	 *
	 * Attempts to connect to each registered server, fetch their agent cards,
	 * and create tool instances. Disables tools for unreachable servers.
	 *
	 * @returns Promise resolving to array of available A2A tools
	 */
	public async getTools(): Promise<A2ATool[]> {
		const tools: A2ATool[] = [];
		for (const url of [...this.a2aPeerServers.keys()]) {
			const tool = this.a2aPeerServers.get(url);
			if (!tool || !tool.enabled) {
				try {
					const client = new A2AClient(url);
					const card: AgentCard = await client.getAgentCard();
					const toolName = card.name.replaceAll(" ", "-");
					const a2aTool = new A2ATool(toolName, client, card);

					tools.push(a2aTool);
				} catch (_error: any) {
					// Agent not responded
					if (tool) {
						tool.disable();
					}
				}
			} else {
				tools.push(tool);
			}
		}
		return tools;
	}

	/**
	 * Gets or creates an A2A session for the given session ID.
	 *
	 * @param threadId - The session identifier
	 * @returns A2ASession object with task and context IDs
	 */
	private getA2ASessionWithId = (threadId: string): A2ASession => {
		const a2aSession = this.a2aSessions.get(threadId) ?? {
			taskId: undefined,
			contextId: undefined,
		};
		if (!this.a2aSessions.has(threadId)) {
			this.a2aSessions.set(threadId, a2aSession);
		}

		return a2aSession;
	};

	/**
	 * Constructs a message payload for A2A communication.
	 *
	 * Includes session context (task ID and context ID) if available
	 * for maintaining conversation continuity.
	 *
	 * @param query - The message content to send
	 * @param threadId - The session identifier
	 * @returns Formatted Message object for A2A protocol
	 */
	public getMessagePayload(query: string, threadId: string): Message {
		const messagePayload: Message = {
			messageId: randomUUID(),
			kind: "message",
			role: "user", // FIXME: it could be 'agent'
			metadata: {
				threadId,
			},
			parts: [
				{
					kind: "text",
					text: query,
				},
			],
		};

		const a2aSession = this.getA2ASessionWithId(threadId);
		if (a2aSession.taskId) {
			messagePayload.taskId = a2aSession.taskId;
		}
		if (a2aSession.contextId) {
			messagePayload.contextId = a2aSession.contextId;
		}

		return messagePayload;
	}

	/**
	 * Executes an A2A tool by sending a message to the remote agent.
	 *
	 * Handles streaming responses, maintains session state, and extracts
	 * text content from various event types in the response stream.
	 *
	 * @param tool - The A2ATool instance to use
	 * @param messagePayload - The message to send to the agent
	 * @param threadId - The session identifier for context tracking
	 * @returns Promise resolving to array of text responses from the agent
	 */
	public async useTool(
		tool: A2ATool,
		messagePayload: Message,
		threadId: string,
	): Promise<string> {
		const finalText: string[] = [];
		const client = tool.client;
		const params: MessageSendParams = {
			message: messagePayload,
		};
		const a2aSession = this.getA2ASessionWithId(threadId);

		try {
			const stream = client.sendMessageStream(params);
			for await (const event of stream) {
				if (event.kind === "status-update") {
					const typedEvent = event as TaskStatusUpdateEvent;
					if (
						typedEvent.final &&
						typedEvent.status.state !== "input-required"
					) {
						a2aSession.taskId = undefined;
					}
					// TODO: handle 'file', 'data' parts
					const texts = typedEvent.status.message?.parts
						.filter((part) => part.kind === "text")
						.map((part: TextPart) => part.text)
						.join("\n");
					if (texts) {
						finalText.push(texts);
					}
				} else if (event.kind === "message") {
					// FIXME: handling text in 'message'?
					const msg = event as Message;
					if (msg.taskId && msg.taskId !== a2aSession.taskId) {
						a2aSession.taskId = msg.taskId;
					}
					if (msg.contextId && msg.contextId !== a2aSession.contextId) {
						a2aSession.contextId = msg.contextId;
					}
				} else if (event.kind === "task") {
					// FIXME: handling text in 'task'?
					const task = event as Task;
					if (task.id !== a2aSession.taskId) {
						a2aSession.taskId = task.id;
					}
					if (task.contextId && task.contextId !== a2aSession.contextId) {
						a2aSession.contextId = task.contextId;
					}
				} else {
					loggers.a2a.warn("Received unknown event structure from stream:", {
						event,
					});
				}
			}
		} catch (error) {
			loggers.a2a.error("Error communicating with agent:", { error });
			tool.disable();
			const toolResult = `[Bot Called A2A Tool ${tool.card.name}]\n${typeof error === "string" ? error : JSON.stringify(error, null, 2)}`;
			return toolResult;
		}

		return `[Bot Called A2A Tool ${tool.card.name}]\n${finalText.join("\n")}`;
	}
}
