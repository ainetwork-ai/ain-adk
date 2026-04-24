import { randomUUID } from "node:crypto";
import type { A2AModule, MemoryModule, ModelModule } from "@/modules";
import {
	type MessageObject,
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	ThreadType,
	type UserWorkflow,
	type WorkflowRenderedBlock,
	type WorkflowResponseBlock,
	type WorkflowTableBlock,
	type WorkflowTask,
	type WorkflowTaskResult,
	type WorkflowTextBlock,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import type { QueryService } from "./query.service.js";
import type { ToolCallingService } from "./tool-calling.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";
import {
	type WorkflowTableRenderResult,
	WorkflowTableService,
} from "./workflow-table.service.js";
import type { WorkflowVariableResolver } from "./workflow-variable-resolver.service.js";

type WorkflowExecutionResult = {
	content: string;
	threadId?: string;
};

export class WorkflowExecutionService {
	private userWorkflowService: UserWorkflowService;
	private queryService: QueryService;
	private workflowVariableResolver: WorkflowVariableResolver;
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private a2aModule?: A2AModule;
	private toolCallingService: ToolCallingService;
	private workflowTableService: WorkflowTableService;

	constructor(
		userWorkflowService: UserWorkflowService,
		queryService: QueryService,
		workflowVariableResolver: WorkflowVariableResolver,
		modelModule: ModelModule,
		memoryModule: MemoryModule,
		toolCallingService: ToolCallingService,
		a2aModule?: A2AModule,
	) {
		this.userWorkflowService = userWorkflowService;
		this.queryService = queryService;
		this.workflowVariableResolver = workflowVariableResolver;
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.toolCallingService = toolCallingService;
		this.a2aModule = a2aModule;
		this.workflowTableService = new WorkflowTableService();
	}

	async executeWorkflow(
		workflowId: string,
		executionVariables?: Record<string, string>,
	): Promise<WorkflowExecutionResult> {
		let content = "";
		let threadId: string | undefined;
		const stream = this.executeWorkflowStream(workflowId, executionVariables);

		for await (const event of stream) {
			if (event.event === "thread_id") {
				threadId = event.data.threadId;
			} else if (event.event === "text_chunk") {
				content += event.data.delta;
			}
		}

		return { content, threadId };
	}

	async *executeWorkflowStream(
		workflowId: string,
		executionVariables?: Record<string, string>,
	): AsyncGenerator<StreamEvent> {
		const workflow = await this.userWorkflowService.getWorkflow(workflowId);
		if (!workflow) {
			throw new Error(`User workflow not found: ${workflowId}`);
		}

		const { query, displayQuery, definition } =
			this.workflowVariableResolver.resolveForExecution(
				workflow,
				executionVariables,
			);

		if (!definition) {
			yield* this.executeLegacyWorkflowStream(workflow, query, displayQuery);
			return;
		}

		loggers.agent.info(
			`Executing structured user workflow: ${workflow.title}`,
			{
				workflowId,
				taskCount: definition.tasks.length,
			},
		);

		const thread = await this.createWorkflowThread(
			workflow,
			displayQuery || workflow.title,
			query,
		);
		yield {
			event: "thread_id",
			data: {
				type: thread.type,
				userId: thread.userId,
				threadId: thread.threadId,
				title: thread.title,
				workflowId: thread.workflowId,
			},
		};

		yield {
			event: "thinking_process",
			data: {
				title: `[워크플로우] ${workflow.title}`,
				description: "워크플로우 실행을 시작합니다.",
				metadata: {
					phase: "workflow_start",
					workflowId,
				},
			},
		};

		const taskResults: Record<string, WorkflowTaskResult> = {};
		for (let i = 0; i < definition.tasks.length; i++) {
			const task = definition.tasks[i];
			loggers.agent.debug(
				`Workflow task starting (${i + 1}/${definition.tasks.length}): ${task.title}`,
				{
					workflowId,
					threadId: thread.threadId,
					taskId: task.taskId,
					executionType: task.agent ? "a2a" : "local",
					agent: task.agent,
					promptPreview: task.prompt?.slice(0, 200),
				},
			);
			const stream = this.executeTask(task, thread, taskResults);
			let result = await stream.next();
			while (!result.done) {
				yield result.value;
				result = await stream.next();
			}
			taskResults[task.taskId] = result.value;
			loggers.agent.debug(
				`Workflow task finished (${i + 1}/${definition.tasks.length}): ${task.title}`,
				{
					workflowId,
					threadId: thread.threadId,
					taskId: task.taskId,
					status: result.value.status,
					durationMs: result.value.completedAt - result.value.startedAt,
					contentLength: result.value.content?.length ?? 0,
					contentPreview: result.value.content?.slice(0, 500),
					error: result.value.error,
				},
			);
		}

		yield {
			event: "thinking_process",
			data: {
				title: "[워크플로우] 응답 구성 중",
				description: "작업 결과를 바탕으로 워크플로우 응답을 구성합니다.",
				metadata: {
					phase: "response_start",
					workflowId,
					blockCount: definition.response.blocks.length,
				},
			},
		};

		const renderedBlocks: WorkflowRenderedBlock[] = [];
		let finalContent = "";
		for (let i = 0; i < definition.response.blocks.length; i++) {
			const block = definition.response.blocks[i];
			loggers.agent.debug(
				`Workflow response block rendering (${i + 1}/${definition.response.blocks.length})`,
				{
					workflowId,
					threadId: thread.threadId,
					blockId: block.blockId,
					blockType: block.type,
					sourceTaskIds:
						block.type === "heading" ? undefined : block.sourceTaskIds,
				},
			);
			const stream = this.renderResponseBlock(block, taskResults);
			let result = await stream.next();
			while (!result.done) {
				if (result.value.event === "text_chunk") {
					finalContent += result.value.data.delta;
				}
				yield result.value;
				result = await stream.next();
			}
			renderedBlocks.push(result.value);
			loggers.agent.debug(
				`Workflow response block rendered (${i + 1}/${definition.response.blocks.length})`,
				{
					workflowId,
					threadId: thread.threadId,
					blockId: result.value.blockId,
					blockType: result.value.type,
					contentLength: result.value.content?.length ?? 0,
					contentPreview: result.value.content?.slice(0, 500),
				},
			);
		}

		await this.addMessageToThread(thread, {
			role: MessageRole.MODEL,
			content: finalContent,
			metadata: {
				workflowId,
				workflowRun: true,
				responseBlocks: renderedBlocks,
			},
		});

		await this.userWorkflowService.updateWorkflow(workflowId, {
			lastRunAt: Date.now(),
			lastThreadId: thread.threadId,
		});

		loggers.agent.info(
			`Structured user workflow completed: ${workflow.title}`,
			{
				workflowId,
				threadId: thread.threadId,
			},
		);
	}

	private async *executeLegacyWorkflowStream(
		workflow: UserWorkflow,
		query: string,
		displayQuery: string,
	): AsyncGenerator<StreamEvent> {
		loggers.agent.info(`Executing legacy user workflow: ${workflow.title}`, {
			workflowId: workflow.workflowId,
			resolvedQuery: query,
		});

		let threadId: string | undefined;
		const stream = this.queryService.handleQuery(
			{
				type: ThreadType.WORKFLOW,
				userId: workflow.userId,
				workflowId: workflow.workflowId,
				title: workflow.title,
			},
			{ query, displayQuery },
		);

		for await (const event of stream) {
			if (event.event === "thread_id") {
				threadId = event.data.threadId;
			}
			yield event;
		}

		await this.userWorkflowService.updateWorkflow(workflow.workflowId, {
			lastRunAt: Date.now(),
			lastThreadId: threadId,
		});
	}

	private async createWorkflowThread(
		workflow: UserWorkflow,
		displayQuery: string,
		resolvedQuery: string,
	): Promise<ThreadObject> {
		const threadMemory = this.memoryModule.getThreadMemory();
		const threadId = randomUUID();
		const title = displayQuery || workflow.title;
		const metadata: ThreadMetadata = (await threadMemory?.createThread(
			ThreadType.WORKFLOW,
			workflow.userId,
			threadId,
			title,
			workflow.workflowId,
		)) || {
			type: ThreadType.WORKFLOW,
			userId: workflow.userId,
			threadId,
			title,
			workflowId: workflow.workflowId,
		};

		const thread: ThreadObject = { ...metadata, messages: [] };
		await this.addMessageToThread(thread, {
			role: MessageRole.USER,
			content: title,
			metadata: {
				workflowId: workflow.workflowId,
				workflowRun: true,
				query: resolvedQuery,
			},
		});

		return thread;
	}

	private async addMessageToThread(
		thread: ThreadObject,
		params: {
			role: MessageRole;
			content: string;
			metadata?: Record<string, unknown>;
		},
	): Promise<void> {
		const message: MessageObject = {
			messageId: randomUUID(),
			role: params.role,
			timestamp: Date.now(),
			content: { type: "text", parts: [params.content] },
			metadata: params.metadata,
		};
		thread.messages.push(message);
		await this.memoryModule
			.getThreadMemory()
			?.addMessagesToThread(thread.userId, thread.threadId, [message]);
	}

	private async *executeTask(
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

	private async *renderResponseBlock(
		block: WorkflowResponseBlock,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, WorkflowRenderedBlock, unknown> {
		yield {
			event: "thinking_process",
			data: {
				title: `[워크플로우] ${this.getBlockTypeLabel(block.type)} 블록 생성 중`,
				description: "작업 결과를 바탕으로 워크플로우 응답을 구성합니다.",
				metadata: {
					phase: "response_block",
					blockId: block.blockId,
					blockType: block.type,
				},
			},
		};

		if (block.type === "heading") {
			const level = block.level ?? 2;
			const content = `${"#".repeat(level)} ${block.text}\n\n`;
			yield { event: "text_chunk", data: { delta: content } };
			return {
				blockId: block.blockId,
				type: block.type,
				content,
			};
		}

		if (block.type === "table") {
			const rendered = yield* this.renderDeterministicTableBlock(
				block,
				taskResults,
			);
			return {
				blockId: block.blockId,
				type: block.type,
				content: rendered.content,
				data: rendered.data,
			};
		}

		const content = yield* this.renderGeneratedTextBlock(
			block,
			taskResults,
			"Generate this workflow response text from the task results. Return only the response block content.",
		);

		const finalContent = content.endsWith("\n\n") ? content : `${content}\n\n`;
		if (finalContent !== content) {
			yield { event: "text_chunk", data: { delta: "\n\n" } };
		}

		return {
			blockId: block.blockId,
			type: block.type,
			content: finalContent,
		};
	}

	private async *renderDeterministicTableBlock(
		block: WorkflowTableBlock,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, WorkflowTableRenderResult, unknown> {
		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const sourceResults = this.getSourceTaskResults(block, taskResults);
		const messages = model.generateMessages({
			query: this.workflowTableService.buildExtractionPrompt(
				block,
				this.serializeTaskResults(sourceResults),
			),
			systemPrompt:
				"Extract only the requested table source values as valid JSON. Return only JSON.",
		});
		const response = await model.fetch(messages, modelOptions);
		const rawContent = response.content || "{}";
		const rendered = this.workflowTableService.renderTable(block, rawContent);
		yield { event: "text_chunk", data: { delta: rendered.content } };
		return rendered;
	}

	private getBlockTypeLabel(type: WorkflowResponseBlock["type"]): string {
		switch (type) {
			case "heading":
				return "제목";
			case "text":
				return "텍스트";
			case "table":
				return "표";
		}
	}

	private async *renderGeneratedTextBlock(
		block: WorkflowTextBlock,
		taskResults: Record<string, WorkflowTaskResult>,
		systemPrompt: string,
	): AsyncGenerator<StreamEvent, string, unknown> {
		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const sourceResults = this.getSourceTaskResults(block, taskResults);
		const messages = model.generateMessages({
			query: this.buildBlockPrompt(block, sourceResults),
			systemPrompt,
		});
		const stream = await model.fetchStreamWithContextMessage(
			messages,
			[],
			modelOptions,
		);

		let content = "";
		for await (const chunk of stream) {
			if (chunk.delta?.content) {
				content += chunk.delta.content;
				yield {
					event: "text_chunk",
					data: { delta: chunk.delta.content },
				};
			}
		}

		return content;
	}

	private getSourceTaskResults(
		block: Exclude<WorkflowResponseBlock, { type: "heading" }>,
		taskResults: Record<string, WorkflowTaskResult>,
	): WorkflowTaskResult[] {
		if (!block.sourceTaskIds || block.sourceTaskIds.length === 0) {
			return Object.values(taskResults);
		}

		return block.sourceTaskIds
			.map((taskId) => taskResults[taskId])
			.filter((result): result is WorkflowTaskResult => Boolean(result));
	}

	private buildBlockPrompt(
		block: WorkflowTextBlock,
		taskResults: WorkflowTaskResult[],
	): string {
		const resultsText = this.serializeTaskResults(taskResults);
		return `Task results:
${resultsText}

Instructions:
${block.prompt}`;
	}

	private serializeTaskResults(taskResults: WorkflowTaskResult[]): string {
		return taskResults
			.map(
				(result) =>
					`[${result.taskId}] ${result.title}\nStatus: ${result.status}\nResult:\n${result.content || result.error || ""}`,
			)
			.join("\n\n---\n\n");
	}
}
