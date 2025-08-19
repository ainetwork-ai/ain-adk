import { randomUUID } from "node:crypto";
import type { Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type {
	AgentExecutor,
	ExecutionEventBus,
	RequestContext,
} from "@a2a-js/sdk/server";
import type { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
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
	): TaskStatusUpdateEvent => {
		return {
			kind: "status-update",
			taskId: taskId,
			contextId: contextId,
			status: {
				state: state,
				message: message
					? {
							kind: "message",
							role: "agent",
							messageId: randomUUID(),
							parts: [{ kind: "text", text: message }],
							taskId: taskId,
							contextId: contextId,
						}
					: undefined,
				timestamp: new Date().toISOString(),
			},
			final: state !== "working",
		};
	};

	async execute(
		requestContext: RequestContext,
		eventBus: ExecutionEventBus,
	): Promise<void> {
		const userMessage = requestContext.userMessage;
		// A2A context ID === AIN ADK thread ID
		const threadId = userMessage.contextId!; // TODO: no context id case

		const { agentId, type } = userMessage.metadata as {
			agentId: string;
			type: ThreadType;
		};
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

		const workingStatusUpdate = this.createTaskStatusUpdateEvent(
			taskId,
			threadId,
			"working",
		);
		eventBus.publish(workingStatusUpdate);

		const message: string = userMessage.parts
			.filter((part) => part.kind === "text")
			.map((part) => part.text)
			.join("\n");
		if (message.length === 0) {
			loggers.server.warn(`Empty message received for task ${taskId}.`);
			const failureUpdate = this.createTaskStatusUpdateEvent(
				taskId,
				threadId,
				"failed",
				"No message found to process.",
			);
			eventBus.publish(failureUpdate);
			return;
		}

		try {
			const response = await this.queryService.handleQuery(
				{ userId: agentId, type, threadId },
				message,
			);

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

			const finalUpdate = this.createTaskStatusUpdateEvent(
				taskId,
				threadId,
				"completed",
				response.content,
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
