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
import { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import { A2ATool } from "./a2a.tool.js";

/**
 * Module for managing Agent-to-Agent (A2A) protocol connections.
 *
 * This module handles connections to other A2A-compatible agents, manages
 * conversation sessions, and provides an interface for inter-agent communication.
 * Supports multi-turn conversations with task and context tracking.
 */
export class A2AModule {
	/** Map of A2A server URLs to their corresponding tool instances */
	private a2aPeerServers: Map<string, A2ATool | null> = new Map();
	/** Map of session IDs to their A2A session state */
	private a2aTasks: Map<string, string> = new Map();
	private agentId: string = randomUUID(); /* FIXME */

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
				agentId: this.agentId,
				type: ThreadType.CHAT,
			},
			parts: [
				{
					kind: "text",
					text: query,
				},
			],
			contextId: threadId,
		};

		if (this.a2aTasks.has(threadId)) {
			messagePayload.taskId = this.a2aTasks.get(threadId);
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
		query: string,
		threadId: string,
	): Promise<string> {
		const finalText: string[] = [];
		const client = tool.client;
		const messagePayload = this.getMessagePayload(query, threadId);
		const params: MessageSendParams = {
			message: messagePayload,
		};

		try {
			const stream = client.sendMessageStream(params);
			for await (const event of stream) {
				if (event.kind === "status-update") {
					const typedEvent = event as TaskStatusUpdateEvent;
					if (
						typedEvent.final &&
						typedEvent.status.state !== "input-required"
					) {
						this.a2aTasks.delete(threadId);
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
					const taskId = this.a2aTasks.get(threadId);
					if (msg.taskId && msg.taskId !== taskId) {
						this.a2aTasks.set(threadId, msg.taskId);
					}
				} else if (event.kind === "task") {
					// establishing the Task ID
					const task = event as Task;
					if (task.id !== this.a2aTasks.get(threadId)) {
						this.a2aTasks.set(threadId, task.id);
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
