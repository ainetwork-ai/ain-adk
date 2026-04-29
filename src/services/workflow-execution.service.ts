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
	type WorkflowTaskResult,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import type { QueryService } from "./query.service.js";
import type { ToolCallingService } from "./tool-calling.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";
import { WorkflowResponseComposer } from "./workflow-response-composer.service.js";
import { WorkflowTableService } from "./workflow-table.service.js";
import { WorkflowTaskRunner } from "./workflow-task-runner.service.js";
import type { WorkflowVariableResolver } from "./workflow-variable-resolver.service.js";

type WorkflowExecutionResult = {
	content: string;
	threadId?: string;
};

export class WorkflowExecutionService {
	private userWorkflowService: UserWorkflowService;
	private queryService: QueryService;
	private workflowVariableResolver: WorkflowVariableResolver;
	private memoryModule: MemoryModule;
	private workflowTaskRunner: WorkflowTaskRunner;
	private workflowResponseComposer: WorkflowResponseComposer;

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
		this.memoryModule = memoryModule;
		this.workflowTaskRunner = new WorkflowTaskRunner(
			modelModule,
			toolCallingService,
			a2aModule,
		);
		this.workflowResponseComposer = new WorkflowResponseComposer(
			modelModule,
			new WorkflowTableService(),
		);
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
			const stream = this.workflowTaskRunner.executeTask(
				task,
				thread,
				taskResults,
			);
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
			const stream = this.workflowResponseComposer.renderResponseBlock(
				block,
				taskResults,
			);
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
}
