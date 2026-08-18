import { randomUUID } from "node:crypto";
import type {
	Artifact as A2AArtifact,
	AgentCard,
	Message,
	MessageSendParams,
	Task,
	TaskArtifactUpdateEvent,
	TaskStatusUpdateEvent,
	TextPart,
} from "@a2a-js/sdk";
import { type Client as A2AClient, ClientFactory } from "@a2a-js/sdk/client";
import { getManifest } from "@/config/manifest.js";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import { ThreadType } from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import {
	artifactContentPartFromA2AArtifact,
	extractArtifactPartsFromA2AMessage,
	serializeA2AMessageForFallback,
} from "@/utils/a2a.js";
import { loggers } from "@/utils/logger.js";
import { serializePartForModelFallback } from "@/utils/message.js";
import { sanitizeThinkingData, withAdkThinkingArg } from "@/utils/tool-args.js";
import { A2AConnector } from "./a2a.connector.js";

/**
 * Module for managing Agent-to-Agent (A2A) protocol connections.
 *
 * This module handles connections to other A2A-compatible agents, manages
 * conversation sessions, and provides an interface for inter-agent communication.
 * Supports multi-turn conversations with task and context tracking.
 */
// JSON.stringify(new Error(...)) is "{}" — message/stack are non-enumerable —
// which erases the failure cause from logs and tool results. Extract them.
const describeA2AError = (
	error: unknown,
): { message: string; stack?: string } =>
	error instanceof Error
		? { message: error.message, stack: error.stack }
		: { message: typeof error === "string" ? error : JSON.stringify(error) };

export class A2AModule {
	/** Communication attempts per send: the first call plus one retry. */
	private static readonly MAX_SEND_ATTEMPTS = 2;

	/** Map of A2A server URLs to their corresponding tool instances */
	private a2aConnectors: Map<string, A2AConnector> = new Map();
	/** Map of session IDs to their A2A session state */
	private a2aTasks: Map<string, string> = new Map();
	private agentId?: string;
	private agentName?: string;

	public configureIdentity(identity: {
		agentId?: string;
		agentName?: string;
	}): void {
		if (identity.agentId?.trim()) {
			this.agentId = identity.agentId;
		}
		if (identity.agentName?.trim()) {
			this.agentName = identity.agentName;
		}
	}

	private getAgentId(): string {
		if (this.agentId) {
			return this.agentId;
		}

		try {
			const manifest = getManifest();
			this.agentId = manifest.url || manifest.name;
		} catch {
			this.agentId = randomUUID();
		}

		return this.agentId;
	}

	private getAgentName(): string | undefined {
		if (this.agentName) {
			return this.agentName;
		}

		try {
			const manifest = getManifest();
			this.agentName = manifest.name;
		} catch {
			this.agentName = undefined;
		}

		return this.agentName;
	}

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

	public hasConnector(connectorName: string): boolean {
		return this.a2aConnectors.has(connectorName);
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
	public async getTools(prompt: string): Promise<ConnectorTool[]> {
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
					inputSchema: withAdkThinkingArg(undefined, prompt),
				};

				tools.push(tool);
			} catch (_error: unknown) {
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
	public getMessagePayload(
		query: string,
		threadId: string,
		metadata?: Record<string, unknown>,
	): Message {
		const messagePayload: Message = {
			messageId: randomUUID(),
			kind: "message",
			role: "agent",
			metadata: {
				agentId: this.getAgentId(),
				agentName: this.getAgentName(),
				type: ThreadType.CHAT,
				...metadata,
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

	private *emitMessageContent(
		message: Pick<Message, "parts">,
		seenArtifactIds: Set<string>,
		appendFinalText: (value: string) => void,
	): Generator<StreamEvent> {
		const fallbackText = serializeA2AMessageForFallback(message);
		if (fallbackText) {
			appendFinalText(fallbackText);
			yield {
				event: "text_chunk",
				data: { delta: fallbackText },
			};
		}

		const artifactParts = extractArtifactPartsFromA2AMessage(message);
		for (const artifactPart of artifactParts) {
			if (seenArtifactIds.has(artifactPart.artifactId)) {
				continue;
			}
			seenArtifactIds.add(artifactPart.artifactId);
			yield {
				event: "artifact_ready",
				data: artifactPart,
			};
		}
	}

	private async *sendMessageToConnector(
		connector: A2AConnector,
		toolName: string,
		query: string,
		threadId: string,
		metadata?: Record<string, unknown>,
	): AsyncGenerator<StreamEvent, string, unknown> {
		const finalText: string[] = [];
		const seenArtifactIds = new Set<string>();
		const appendFinalText = (value: string) => {
			if (value && !finalText.includes(value)) {
				finalText.push(value);
			}
		};
		const messagePayload = this.getMessagePayload(query, threadId, metadata);
		const params: MessageSendParams = {
			message: messagePayload,
		};

		const client = await this.getOrCreateClient(connector);
		const stream = client.sendMessageStream(params);
		for await (const event of stream) {
			if (event.kind === "status-update") {
				const typedEvent = event as TaskStatusUpdateEvent;
				if (typedEvent.final && typedEvent.status.state !== "input-required") {
					this.a2aTasks.delete(threadId);
				}

				if (typedEvent.status.state === "working") {
					const text = (typedEvent.status.message?.parts[0] as TextPart)?.text;
					if (!text) {
						continue;
					}

					let thinkingData: {
						title: string;
						description: string;
						metadata?: Record<string, unknown>;
					};
					try {
						thinkingData = JSON.parse(text);
					} catch (error) {
						loggers.a2a.warn(
							"Failed to parse A2A working status as JSON; using plain text fallback",
							{ error, text },
						);
						thinkingData = { title: text, description: "" };
					}

					yield {
						event: "thinking_process",
						data: sanitizeThinkingData(thinkingData),
					};
				} else if (typedEvent.status.state === "completed") {
					if (typedEvent.status.message?.parts.length) {
						yield* this.emitMessageContent(
							typedEvent.status.message,
							seenArtifactIds,
							appendFinalText,
						);
					}
				}
			} else if (event.kind === "artifact-update") {
				const artifact = artifactContentPartFromA2AArtifact(
					(event as TaskArtifactUpdateEvent).artifact as A2AArtifact,
				);
				if (!seenArtifactIds.has(artifact.artifactId)) {
					seenArtifactIds.add(artifact.artifactId);
					yield {
						event: "artifact_ready",
						data: artifact,
					};
				}
				appendFinalText(serializePartForModelFallback(artifact));
			} else if (event.kind === "message") {
				const msg = event as Message;
				const taskId = this.a2aTasks.get(threadId);
				if (msg.taskId && msg.taskId !== taskId) {
					this.a2aTasks.set(threadId, msg.taskId);
				}
				if (msg.parts.length > 0) {
					yield* this.emitMessageContent(msg, seenArtifactIds, appendFinalText);
				}
			} else if (event.kind === "task") {
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

		return `[Bot Called A2A Tool ${toolName}]\n${finalText.join("\n")}`;
	}

	/**
	 * Sends a message through the connector, retrying once on communication
	 * failure (network error, stream timeout, connection reset). A failed
	 * attempt may have left a broken task mapping for the thread, so it is
	 * dropped to let the retry start a fresh task.
	 *
	 * Retries ONLY when the failed attempt delivered no events: once the
	 * consumer has seen output, the remote agent is already executing, and
	 * re-sending would both run the task twice and replay the delivered
	 * events. Throws the last error when no (further) attempt is allowed.
	 */
	private async *sendWithRetry(
		connector: A2AConnector,
		toolName: string,
		query: string,
		threadId: string,
		metadata?: Record<string, unknown>,
	): AsyncGenerator<StreamEvent, string, unknown> {
		let lastError: unknown;
		for (let attempt = 1; attempt <= A2AModule.MAX_SEND_ATTEMPTS; attempt++) {
			let yielded = false;
			try {
				const stream = this.sendMessageToConnector(
					connector,
					toolName,
					query,
					threadId,
					metadata,
				);
				let step = await stream.next();
				while (!step.done) {
					yielded = true;
					yield step.value;
					step = await stream.next();
				}
				return step.value;
			} catch (error) {
				lastError = error;
				const { message, stack } = describeA2AError(error);
				loggers.a2a.error(
					`Error communicating with agent (attempt ${attempt}/${A2AModule.MAX_SEND_ATTEMPTS}):`,
					{ toolName, threadId, error: message, stack },
				);
				this.a2aTasks.delete(threadId);
				if (yielded) throw error;
			}
		}
		throw lastError;
	}

	public async *sendTask(params: {
		connectorName: string;
		message: string;
		threadId: string;
		metadata?: Record<string, unknown>;
	}): AsyncGenerator<StreamEvent, string, unknown> {
		const connector = this.a2aConnectors.get(params.connectorName);
		if (!connector) {
			loggers.a2a.error("Unknown agent connector:", {
				connectorName: params.connectorName,
			});
			return `[Bot Called A2A Tool ${params.connectorName}]\n"Unknown agent connector"`;
		}

		// No catch: after the retry is exhausted the error propagates, so
		// callers (e.g. workflow tasks) record a real failure instead of
		// mistaking the error text for a completed result.
		return yield* this.sendWithRetry(
			connector,
			params.connectorName,
			params.message,
			params.threadId,
			params.metadata,
		);
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
	 * @yields StreamEvent objects for intermediate events
	 * @returns Final text response from the agent
	 */
	public async *useTool(
		tool: ConnectorTool,
		query: string,
		threadId: string,
	): AsyncGenerator<StreamEvent, string, unknown> {
		const connector = this.a2aConnectors.get(tool.connectorName);
		if (!connector) {
			loggers.a2a.error("Unknown agent:", { tool });
			const toolResult = `[Bot Called A2A Tool ${tool.connectorName}]\n"Unknown agent connector"`;
			return toolResult;
		}

		try {
			return yield* this.sendWithRetry(
				connector,
				tool.toolName,
				query,
				threadId,
			);
		} catch (error) {
			// Interactive tool-calling path: surface the failure to the model
			// as tool output (with the actual cause) instead of throwing, so
			// the LLM can react to it mid-conversation.
			return `[Bot Called A2A Tool ${tool.toolName}]\n${describeA2AError(error).message}`;
		}
	}
}
