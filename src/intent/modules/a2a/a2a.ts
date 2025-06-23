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
import { A2ATool } from "./a2aTool.js";

interface A2AThread {
	taskId: string | undefined;
	contextId: string | undefined;
}
export class A2AModule {
	private a2aServers: Map<string, A2ATool> = new Map();
	private threads: Map<string, A2AThread> = new Map();

	public async addA2AServer(url: string): Promise<void> {
		try {
			const client = new A2AClient(url);
			const card: AgentCard = await client.getAgentCard();
			const toolName = card.name.replace(" ", "-");
			const a2aTool = new A2ATool(toolName, client);

			this.a2aServers.set(toolName, a2aTool);
		} catch (error: any) {
			loggers.a2a.error("Error fetching or parsing agent card", { error });
			throw error;
		}
	}

	public getTools(): A2ATool[] {
		return Array.from(this.a2aServers.values());
	}

	private getThreadWithId = (threadId: string): A2AThread => {
		const thread = this.threads.get(threadId) ?? {
			taskId: undefined,
			contextId: undefined,
		};
		if (!this.threads.has(threadId)) {
			this.threads.set(threadId, thread);
		}

		return thread;
	};

	public getMessagePayload(query: string, threadId: string): Message {
		const messagePayload: Message = {
			messageId: randomUUID(),
			kind: "message",
			role: "user", // FIXME: it could be 'agent'
			parts: [
				{
					kind: "text",
					text: query,
				},
			],
		};

		const thread = this.getThreadWithId(threadId);
		if (thread.taskId) {
			messagePayload.taskId = thread.taskId;
		}
		if (thread.contextId) {
			messagePayload.contextId = thread.contextId;
		}

		return messagePayload;
	}

	public async useTool(
		tool: A2ATool,
		messagePayload: Message,
		threadId: string,
	): Promise<string[]> {
		const finalText: string[] = [];
		const client = tool.client;
		const params: MessageSendParams = {
			message: messagePayload,
		};
		const thread = this.getThreadWithId(threadId);

		try {
			const stream = client.sendMessageStream(params);
			for await (const event of stream) {
				if (event.kind === "status-update") {
					const typedEvent = event as TaskStatusUpdateEvent;
					if (
						typedEvent.final &&
						typedEvent.status.state !== "input-required"
					) {
						thread.taskId = undefined;
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
					if (msg.taskId && msg.taskId !== thread.taskId) {
						thread.taskId = msg.taskId;
					}
					if (msg.contextId && msg.contextId !== thread.contextId) {
						thread.contextId = msg.contextId;
					}
				} else if (event.kind === "task") {
					// FIXME: handling text in 'task'?
					const task = event as Task;
					if (task.id !== thread.taskId) {
						thread.taskId = task.id;
					}
					if (task.contextId && task.contextId !== thread.contextId) {
						thread.contextId = task.contextId;
					}
				} else {
					loggers.a2a.warn("Received unknown event structure from stream:", {
						event,
					});
				}
			}
		} catch (error: any) {
			loggers.a2a.error("Error communicating with agent:", { error });
		}

		return finalText;
	}
}
