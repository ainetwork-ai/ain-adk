import { randomUUID } from "node:crypto";
import type {
	AgentCard,
	Message,
	MessageSendParams,
	Task,
	TaskStatusUpdateEvent,
	TextPart,
} from "@a2a-js/sdk";
import { type Client as A2AClient, ClientFactory } from "@a2a-js/sdk/client";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import { A2AConnector } from "./a2a.connector.js";

/**
 * Module for managing Agent-to-Agent (A2A) protocol connections.
 *
 * This module handles connections to other A2A-compatible agents, manages
 * conversation sessions, and provides an interface for inter-agent communication.
 * Supports multi-turn conversations with task and context tracking.
 */
export class A2AModule {
	/** Map of A2A server URLs to their corresponding tool instances */
	private a2aConnectors: Map<string, A2AConnector> = new Map();
	/** Map of session IDs to their A2A session state */
	private a2aTasks: Map<string, string> = new Map();
	private agentId: string = randomUUID(); /* FIXME */

	/**
	 * Registers a new A2A peer server URL for connection.
	 *
	 * @param conns - Set of name, url pair
	 */
	public async addA2AConnector(conns: {
		[name: string]: string;
	}): Promise<void> {
		for (const [name, url] of Object.entries(conns)) {
			const conn = new A2AConnector(name, url);
			this.a2aConnectors.set(name, conn);
		}
	}

	public getA2AConnectors(): Array<{ name: string; url: string }> {
		const connectors: Array<{ name: string; url: string }> = [];
		for (const [name, connector] of this.a2aConnectors.entries()) {
			connectors.push({ name, url: connector.url });
		}
		return connectors;
	}

	private async getOrCreateClient(connector: A2AConnector): Promise<A2AClient> {
		if (!connector.client) {
			connector.client = await new ClientFactory().createFromUrl(connector.url);
		}
		return connector.client;
	}

	/**
	 * Retrieves tools from all registered A2A peer servers.
	 *
	 * Attempts to connect to each registered server, fetch their agent cards,
	 * and create tool instances. Disables tools for unreachable servers.
	 *
	 * @returns Promise resolving to array of available A2A tools
	 */
	public async getTools(): Promise<ConnectorTool[]> {
		const tools: ConnectorTool[] = [];
		for (const [name, conn] of this.a2aConnectors.entries()) {
			if (!conn.enabled) {
				continue; // skip disabled agent
			}

			try {
				const client = await this.getOrCreateClient(conn);
				const card: AgentCard = await client.getAgentCard();
				/* TODO: add each skill as tool? */
				const tool: ConnectorTool = {
					toolName: card.name.replaceAll(" ", "-"),
					connectorName: name,
					protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
					description: card.description,
					// add thinking_text inputSchema
					inputSchema: {
						type: "object",
						properties: {
							thinking_text: {
								type: "string",
								description:
									"사용자의 요청을 해결하기 위해 이 도구를 선택한 구체적인 이유와 목적 (Why & What). 한두줄 정도의 분량으로 입력 언어와 같은 언어로 생성한다.",
							},
						},
						required: ["thinking_text"],
					},
				};

				tools.push(tool);
			} catch (_error: any) {
				// Agent not responded, just skip
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
	 * @param query - The message to send to the agent
	 * @param threadId - The session identifier for context tracking
	 * @returns Promise resolving to array of text responses from the agent
	 */
	public async useTool(
		tool: ConnectorTool,
		query: string,
		threadId: string,
	): Promise<string> {
		const finalText: string[] = [];
		const connector = this.a2aConnectors.get(tool.connectorName);
		if (!connector) {
			loggers.a2a.error("Unknown agent:", { tool });
			const toolResult = `[Bot Called A2A Tool ${tool.connectorName}]\n"Unknown agent connector"`;
			return toolResult;
		}

		const messagePayload = this.getMessagePayload(query, threadId);
		const params: MessageSendParams = {
			message: messagePayload,
		};

		try {
			const client = await this.getOrCreateClient(connector);
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
			const toolResult = `[Bot Called A2A Tool ${tool.toolName}]\n${typeof error === "string" ? error : JSON.stringify(error, null, 2)}`;
			return toolResult;
		}

		return `[Bot Called A2A Tool ${tool.toolName}]\n${finalText.join("\n")}`;
	}
}
