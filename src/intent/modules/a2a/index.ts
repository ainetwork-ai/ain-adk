import { randomUUID } from "node:crypto";
import {
	A2AClient,
	type AgentCard,
	type Message,
	type MessageSendParams,
	type Task,
	type TaskStatusUpdateEvent,
	type TextPart,
} from "@a2a-js/sdk";
import { loggers } from "@/utils/logger.js";
import { A2ATool } from "./tool.js";

interface A2ASession {
	taskId: string | undefined;
	contextId: string | undefined;
}

export class A2AModule {
	private a2aServers: Map<string, A2ATool | null> = new Map();
	private a2aSessions: Map<string, A2ASession> = new Map(); // Map from session ID to A2A ids

	public async addA2AServer(url: string): Promise<void> {
		this.a2aServers.set(url, null);
	}

	public async getTools(): Promise<A2ATool[]> {
		const tools: A2ATool[] = [];
		for (const url of [...this.a2aServers.keys()]) {
			const tool = this.a2aServers.get(url);
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

	private getA2ASessionWithId = (sessionId: string): A2ASession => {
		const a2aSession = this.a2aSessions.get(sessionId) ?? {
			taskId: undefined,
			contextId: undefined,
		};
		if (!this.a2aSessions.has(sessionId)) {
			this.a2aSessions.set(sessionId, a2aSession);
		}

		return a2aSession;
	};

	public getMessagePayload(query: string, sessionId: string): Message {
		const messagePayload: Message = {
			messageId: randomUUID(),
			kind: "message",
			role: "user", // FIXME: it could be 'agent'
			metadata: {
				sessionId,
			},
			parts: [
				{
					kind: "text",
					text: query,
				},
			],
		};

		const a2aSession = this.getA2ASessionWithId(sessionId);
		if (a2aSession.taskId) {
			messagePayload.taskId = a2aSession.taskId;
		}
		if (a2aSession.contextId) {
			messagePayload.contextId = a2aSession.contextId;
		}

		return messagePayload;
	}

	public async useTool(
		tool: A2ATool,
		messagePayload: Message,
		sessionId: string,
	): Promise<string[]> {
		const finalText: string[] = [];
		const client = tool.client;
		const params: MessageSendParams = {
			message: messagePayload,
		};
		const a2aSession = this.getA2ASessionWithId(sessionId);

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
		} catch (error: unknown) {
			loggers.a2a.error("Error communicating with agent:", { error });
			tool.disable();
			// TODO: add failed & disabled text for next inference?
		}

		return finalText;
	}
}
