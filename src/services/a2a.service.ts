import { randomUUID } from "node:crypto";
import type {
	Artifact as A2AArtifact,
	Message as A2AMessage,
	Part as A2APart,
	Task,
	TaskArtifactUpdateEvent,
	TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import type {
	AgentExecutor,
	ExecutionEventBus,
	RequestContext,
} from "@a2a-js/sdk/server";
import { ThreadType } from "@/types/memory.js";
import {
	createA2AArtifactsFromMessage,
	createA2AMessagePartsFromMessage,
	createQueryInputFromA2AMessage,
} from "@/utils/a2a.js";
import { loggers } from "@/utils/logger.js";
import {
	createModelInputMessageFromQueryInput,
	serializeMessageForModelFallback,
} from "@/utils/message.js";
import type { QueryService } from "./query.service.js";

/**
 * Implements the AgentExecutor interface from the a2a-js-sdk.
 * This service is responsible for the core business logic of executing an A2A task.
 */
export class A2AService implements AgentExecutor {
	private queryService: QueryService;
	private canceledTasks: Set<string> = new Set<string>();

	constructor(queryService: QueryService) {
		this.queryService = queryService;
	}

	public cancelTask = async (
		taskId: string,
		_eventBus: ExecutionEventBus,
	): Promise<void> => {
		this.canceledTasks.add(taskId);
	};

	private createTaskStatusUpdateEvent = (
		taskId: string,
		contextId: string,
		state: "working" | "failed" | "canceled" | "completed",
		message?: string,
		parts?: A2APart[],
	): TaskStatusUpdateEvent => {
		const statusMessage: A2AMessage | undefined =
			parts && parts.length > 0
				? {
						kind: "message",
						role: "agent",
						messageId: randomUUID(),
						parts,
						taskId,
						contextId,
					}
				: message
					? {
							kind: "message",
							role: "agent",
							messageId: randomUUID(),
							parts: [{ kind: "text", text: message }],
							taskId,
							contextId,
						}
					: undefined;

		return {
			kind: "status-update",
			taskId: taskId,
			contextId: contextId,
			status: {
				state: state,
				message: statusMessage,
				timestamp: new Date().toISOString(),
			},
			final: state !== "working",
		};
	};

	private createTaskArtifactUpdateEvent(
		taskId: string,
		contextId: string,
		artifact: A2AArtifact,
	): TaskArtifactUpdateEvent {
		return {
			kind: "artifact-update",
			taskId,
			contextId,
			artifact,
			lastChunk: true,
		};
	}

	private getRequestMetadata(requestContext: RequestContext): {
		agentId: string;
		type: ThreadType;
	} {
		const metadata =
			typeof requestContext.userMessage.metadata === "object" &&
			requestContext.userMessage.metadata !== null
				? requestContext.userMessage.metadata
				: {};

		const agentId =
			typeof (metadata as { agentId?: unknown }).agentId === "string"
				? (metadata as { agentId: string }).agentId
				: requestContext.userMessage.taskId ||
					requestContext.userMessage.contextId ||
					"anonymous-a2a-agent";

		const rawType = (metadata as { type?: unknown }).type;
		const type =
			rawType === ThreadType.WORKFLOW ? ThreadType.WORKFLOW : ThreadType.CHAT;

		return { agentId, type };
	}

	async execute(
		requestContext: RequestContext,
		eventBus: ExecutionEventBus,
	): Promise<void> {
		const userMessage = requestContext.userMessage;
		// A2A context ID === AIN ADK thread ID
		const threadId =
			userMessage.contextId || requestContext.task?.contextId || randomUUID();

		const { agentId, type } = this.getRequestMetadata(requestContext);
		const existingTask = requestContext.task;

		const taskId = existingTask?.id || randomUUID();

		if (!existingTask) {
			const initialTask: Task = {
				kind: "task",
				id: taskId,
				contextId: threadId,
				status: {
					state: "submitted",
					timestamp: new Date().toISOString(),
				},
				history: [userMessage],
				metadata: userMessage.metadata,
				artifacts: [],
			};
			eventBus.publish(initialTask);
		}

		const input = createQueryInputFromA2AMessage(userMessage);
		if (input.parts.length === 0) {
			loggers.server.warn(`Empty message received for task ${taskId}.`);
			const failureUpdate = this.createTaskStatusUpdateEvent(
				taskId,
				threadId,
				"failed",
				"No supported content parts found to process.",
			);
			eventBus.publish(failureUpdate);
			return;
		}

		const query = serializeMessageForModelFallback(
			createModelInputMessageFromQueryInput({ input }),
		);

		const stream = this.queryService.handleQuery(
			{ userId: agentId, type, threadId },
			{ query, input },
			true,
		);

		try {
			let finalResponseText = "";
			let finalResponseParts: A2APart[] | undefined;
			let finalArtifacts: A2AArtifact[] = [];
			for await (const event of stream) {
				if (this.canceledTasks.has(taskId)) {
					loggers.server.info(`Task ${taskId} was canceled.`);
					const canceledUpdate = this.createTaskStatusUpdateEvent(
						taskId,
						threadId,
						"canceled",
					);
					eventBus.publish(canceledUpdate);
					return;
				}

				if (event.event === "text_chunk") {
					finalResponseText += event.data.delta;
				} else if (event.event === "message_complete") {
					finalResponseText = serializeMessageForModelFallback(
						event.data.message,
					);
					finalResponseParts = createA2AMessagePartsFromMessage(
						event.data.message,
					);
					finalArtifacts = createA2AArtifactsFromMessage(event.data.message);
				} else if (event.event === "thinking_process") {
					const thinkingProcessUpdate = this.createTaskStatusUpdateEvent(
						taskId,
						threadId,
						"working",
						JSON.stringify(event.data),
					);
					eventBus.publish(thinkingProcessUpdate);
				}
			}

			for (const artifact of finalArtifacts) {
				eventBus.publish(
					this.createTaskArtifactUpdateEvent(taskId, threadId, artifact),
				);
			}

			const finalUpdate = this.createTaskStatusUpdateEvent(
				taskId,
				threadId,
				"completed",
				finalResponseText,
				finalResponseParts,
			);
			eventBus.publish(finalUpdate);
			loggers.server.info(`Task ${taskId} completed successfully.`);
		} catch (error: any) {
			loggers.server.error(`Error processing task ${taskId}:`, error);
			const errorUpdate = this.createTaskStatusUpdateEvent(
				taskId,
				threadId,
				"failed",
				`Agent error: ${error.message}`,
			);
			eventBus.publish(errorUpdate);
		}
	}
}
