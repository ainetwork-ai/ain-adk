import type { A2AModule, ModelModule } from "@/modules";
import {
	type ThreadObject,
	ThreadType,
	type WorkflowTask,
	type WorkflowTaskResult,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import type { ToolCallingService } from "./tool-calling.service.js";

export class WorkflowTaskRunner {
	private modelModule: ModelModule;
	private toolCallingService: ToolCallingService;
	private a2aModule?: A2AModule;

	constructor(
		modelModule: ModelModule,
		toolCallingService: ToolCallingService,
		a2aModule?: A2AModule,
	) {
		this.modelModule = modelModule;
		this.toolCallingService = toolCallingService;
		this.a2aModule = a2aModule;
	}

	async *executeTask(
		task: WorkflowTask,
		thread: ThreadObject,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, WorkflowTaskResult, unknown> {
		const startedAt = Date.now();
		yield {
			event: "thinking_process",
			data: {
				title: `[워크플로우] 작업 실행: ${task.title}`,
				description: task.agent
					? `${task.agent.connectorName} 에이전트에 작업을 위임합니다.`
					: "로컬에서 작업을 실행합니다.",
				metadata: {
					phase: "task",
					taskId: task.taskId,
					agent: task.agent,
				},
			},
		};

		try {
			const content = task.agent
				? yield* this.executeA2ATask(task, thread, taskResults)
				: yield* this.executeLocalTask(task, thread, taskResults);

			return {
				taskId: task.taskId,
				title: task.title,
				agent: task.agent,
				status: "completed",
				content,
				startedAt,
				completedAt: Date.now(),
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : JSON.stringify(error);
			loggers.agent.error(`Workflow task failed: ${task.taskId}`, { error });
			return {
				taskId: task.taskId,
				title: task.title,
				agent: task.agent,
				status: "failed",
				content: "",
				error: message,
				startedAt,
				completedAt: Date.now(),
			};
		}
	}

	private async *executeLocalTask(
		task: WorkflowTask,
		thread: ThreadObject,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, string, unknown> {
		const model = this.modelModule.getModel();
		const messages = model.generateMessages({
			query: this.buildTaskPrompt(task, taskResults),
			systemPrompt:
				"You execute one local workflow task. Use MCP tools when useful, use the provided previous task results as context, and return only the task result.",
		});

		const tools = await this.toolCallingService.getTools({
			toolPrompt:
				"현재 워크플로우 작업에 이 MCP 도구가 필요한 이유와 기대하는 결과를 한국어로 구체적으로 작성하세요.",
			mode: "mcp",
		});
		const stream = this.toolCallingService.run({
			messages,
			tools,
			query: task.prompt,
			thread,
			toolChoice: "auto",
		});

		let content = "";
		let result = await stream.next();
		while (!result.done) {
			if (result.value.event === "text_chunk") {
				content += result.value.data.delta;
			}
			yield result.value;
			result = await stream.next();
		}
		return content;
	}

	private async *executeA2ATask(
		task: WorkflowTask,
		thread: ThreadObject,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, string, unknown> {
		if (!this.a2aModule || !task.agent) {
			throw new Error("A2A module is not configured for this workflow task.");
		}

		const message = this.buildTaskPrompt(task, taskResults);
		loggers.agent.debug(`Delegating workflow task via A2A: ${task.taskId}`, {
			taskId: task.taskId,
			connectorName: task.agent.connectorName,
			threadId: thread.threadId,
			messageLength: message.length,
			messagePreview: message.slice(0, 500),
		});

		let content = "";
		const stream = this.a2aModule.sendTask({
			connectorName: task.agent.connectorName,
			message,
			threadId: thread.threadId,
			metadata: {
				type: ThreadType.WORKFLOW,
				workflowId: thread.workflowId,
				taskId: task.taskId,
			},
		});

		let result = await stream.next();
		while (!result.done) {
			if (result.value.event === "thinking_process") {
				yield result.value;
			} else if (result.value.event === "text_chunk") {
				content += result.value.data.delta;
			}
			result = await stream.next();
		}

		return content || result.value;
	}

	private buildTaskPrompt(
		task: WorkflowTask,
		taskResults: Record<string, WorkflowTaskResult>,
	): string {
		const previousResults = Object.values(taskResults)
			.map(
				(result) =>
					`[${result.taskId}] ${result.title}\nStatus: ${result.status}\nResult:\n${result.content || result.error || ""}`,
			)
			.join("\n\n---\n\n");

		return `${previousResults ? `Previous task results:\n${previousResults}\n\n` : ""}Task:
${task.prompt}`;
	}
}
