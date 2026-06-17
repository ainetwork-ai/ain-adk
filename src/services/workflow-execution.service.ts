import { randomUUID } from "node:crypto";
import type { A2AModule, MemoryModule, ModelModule } from "@/modules";
import {
	type Document,
	DocumentFormat,
	type DocumentFragment,
	type DocumentSlot,
	DocumentSource,
} from "@/types/document.js";
import {
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	ThreadType,
	type UserWorkflow,
	type WorkflowDefinition,
	type WorkflowRenderedBlock,
	type WorkflowTaskResult,
	type WorkflowTemplate,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import {
	appendRichMessageToThread,
	appendTextMessageToThread,
} from "@/utils/thread-messages.js";
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
		signal?: AbortSignal,
	): Promise<WorkflowExecutionResult> {
		let content = "";
		let threadId: string | undefined;
		const stream = this.executeWorkflowStream(
			workflowId,
			executionVariables,
			signal,
		);

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
		signal?: AbortSignal,
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

		const { finalContent, renderedBlocks, executionError } =
			yield* this.renderStructuredDefinition(
				definition,
				thread,
				workflowId,
				signal,
			);

		const responseContent =
			finalContent || (executionError ? `오류: ${executionError.message}` : "");
		try {
			const documentMemory = this.memoryModule.getDocumentMemory();
			if (documentMemory && !executionError && finalContent) {
				// Promote the workflow result to a first-class document and
				// reference it from the thread (body is resolved on demand).
				const documentId = randomUUID();
				const now = new Date().toISOString();
				await documentMemory.createDocument({
					documentId,
					userId: workflow.userId,
					title: thread.title,
					format: DocumentFormat.MARKDOWN,
					content: finalContent,
					blocks: renderedBlocks,
					source: DocumentSource.WORKFLOW,
					workflowId,
					threadId: thread.threadId,
					version: 1,
					createdAt: now,
					updatedAt: now,
				});
				await appendRichMessageToThread(
					this.memoryModule,
					thread,
					MessageRole.MODEL,
					[{ type: "document", documentId, title: thread.title }],
					{
						workflowId,
						workflowRun: true,
						documentId,
					},
				);
			} else {
				// No document memory (or execution failed): keep the legacy
				// inline text message with structured blocks in metadata.
				await appendTextMessageToThread(
					this.memoryModule,
					thread,
					MessageRole.MODEL,
					responseContent,
					{
						workflowId,
						workflowRun: true,
						responseBlocks: renderedBlocks,
						...(executionError ? { error: executionError.message } : {}),
					},
				);
			}
		} catch (saveError) {
			loggers.agent.error("Failed to save workflow response message", {
				workflowId,
				threadId: thread.threadId,
				error: saveError,
			});
		}

		try {
			await this.userWorkflowService.updateWorkflow(workflowId, {
				userId: workflow.userId,
				lastRunAt: Date.now(),
				lastThreadId: thread.threadId,
			});
		} catch (updateError) {
			loggers.agent.error("Failed to update workflow lastRunAt", {
				workflowId,
				error: updateError,
			});
		}

		if (executionError) {
			throw executionError;
		}
	}

	/**
	 * Runs a structured workflow definition (tasks → response blocks) against a
	 * thread context, streaming progress events. Never throws — any failure is
	 * captured and returned as `executionError` so callers can decide how to
	 * persist the (partial) result.
	 */
	private async *renderStructuredDefinition(
		definition: WorkflowDefinition,
		thread: ThreadObject,
		workflowId: string,
		signal?: AbortSignal,
	): AsyncGenerator<
		StreamEvent,
		{
			finalContent: string;
			renderedBlocks: WorkflowRenderedBlock[];
			executionError?: Error;
		},
		unknown
	> {
		const taskResults: Record<string, WorkflowTaskResult> = {};
		const renderedBlocks: WorkflowRenderedBlock[] = [];
		let finalContent = "";
		let executionError: Error | undefined;
		let firstFailedTaskId: string | undefined;

		try {
			yield {
				event: "thinking_process",
				data: {
					title: "[워크플로우] 실행",
					description: "워크플로우 실행을 시작합니다.",
					metadata: {
						phase: "workflow_start",
						workflowId,
					},
				},
			};

			for (let i = 0; i < definition.tasks.length; i++) {
				if (signal?.aborted) {
					throw new Error("Workflow execution aborted by client");
				}
				const task = definition.tasks[i];

				if (firstFailedTaskId) {
					taskResults[task.taskId] = {
						taskId: task.taskId,
						title: task.title,
						agent: task.agent,
						status: "skipped",
						content: "",
						error: `Skipped due to failure of task ${firstFailedTaskId}`,
						startedAt: Date.now(),
						completedAt: Date.now(),
					};
					yield {
						event: "thinking_process",
						data: {
							title: `[워크플로우] 작업 건너뜀: ${task.title}`,
							description: `이전 작업(${firstFailedTaskId}) 실패로 인해 건너뜁니다.`,
							metadata: {
								phase: "task_skipped",
								taskId: task.taskId,
								reason: "previous_task_failed",
								failedTaskId: firstFailedTaskId,
							},
						},
					};
					continue;
				}

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
					if (result.value.event === "text_chunk") {
						loggers.agent.warn(
							"Suppressed unexpected workflow task text_chunk before response phase",
							{
								workflowId,
								threadId: thread.threadId,
								taskId: task.taskId,
								taskTitle: task.title,
								deltaPreview: result.value.data.delta.slice(0, 200),
							},
						);
					} else {
						yield result.value;
					}
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

				if (result.value.status === "failed") {
					firstFailedTaskId = task.taskId;
				}
			}

			if (firstFailedTaskId) {
				const failed = taskResults[firstFailedTaskId];
				throw new Error(
					`Workflow task failed: ${firstFailedTaskId} - ${failed?.error ?? "unknown error"}`,
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

			for (let i = 0; i < definition.response.blocks.length; i++) {
				if (signal?.aborted) {
					throw new Error("Workflow execution aborted by client");
				}
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
					renderedBlocks,
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

			loggers.agent.info("Structured workflow definition completed", {
				workflowId,
				threadId: thread.threadId,
			});
		} catch (error) {
			executionError =
				error instanceof Error ? error : new Error(String(error));
			loggers.agent.error("Structured workflow definition failed", {
				workflowId,
				threadId: thread.threadId,
				error: executionError.message,
			});
		}

		return { finalContent, renderedBlocks, executionError };
	}

	/**
	 * Non-streaming variant of {@link fillDocumentSlotStream}.
	 */
	async fillDocumentSlot(
		documentId: string,
		slotId: string,
		options?: {
			workflowId?: string;
			executionVariables?: Record<string, string>;
		},
		signal?: AbortSignal,
	): Promise<{ documentId: string; slotId: string; content: string }> {
		let content = "";
		for await (const event of this.fillDocumentSlotStream(
			documentId,
			slotId,
			options,
			signal,
		)) {
			if (event.event === "text_chunk") {
				content += event.data.delta;
			}
		}
		return { documentId, slotId, content };
	}

	/**
	 * Fills a single document slot by running its bound workflow (or an
	 * explicitly provided one). Unlike {@link executeWorkflowStream}, this does
	 * NOT create or persist a thread — the document slot is the only artifact.
	 * Progress is streamed live but not persisted anywhere.
	 */
	async *fillDocumentSlotStream(
		documentId: string,
		slotId: string,
		options?: {
			workflowId?: string;
			executionVariables?: Record<string, string>;
		},
		signal?: AbortSignal,
	): AsyncGenerator<StreamEvent> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		if (!documentMemory) {
			throw new Error("Document memory is not initialized");
		}

		const document = await documentMemory.getDocument(documentId);
		if (!document) {
			throw new Error(`Document not found: ${documentId}`);
		}

		const slot = document.slots?.find((s) => s.slotId === slotId);
		if (!slot) {
			throw new Error(`Document slot not found: ${documentId}/${slotId}`);
		}

		// Resolve which workflow fills this slot (explicit override > binding).
		const workflowId =
			options?.workflowId ??
			(slot.binding?.type === "WORKFLOW" ? slot.binding.workflowId : undefined);
		if (!workflowId) {
			throw new Error(
				`No workflow bound to slot ${documentId}/${slotId}; provide workflowId`,
			);
		}
		const executionVariables =
			options?.executionVariables ??
			(slot.binding?.type === "WORKFLOW"
				? slot.binding.executionVariables
				: undefined);

		yield {
			event: "document_id",
			data: { documentId, slotId },
		};

		// A slot may bind to either a user workflow or a workflow template.
		const workflow = await this.getFillableWorkflow(workflowId);
		if (!workflow) {
			throw new Error(`User workflow or template not found: ${workflowId}`);
		}

		const { definition } = this.workflowVariableResolver.resolveForDocumentFill(
			workflow,
			executionVariables,
		);
		if (!definition) {
			throw new Error(
				`Workflow ${workflowId} has no structured definition; cannot fill slot`,
			);
		}

		await this.updateSlot(documentMemory, document, slotId, {
			status: "running",
			error: undefined,
		});

		// Ephemeral, non-persisted thread: carries threadId for A2A correlation
		// and task context, but is never written to the thread store.
		const thread: ThreadObject = {
			type: ThreadType.WORKFLOW,
			userId: document.userId,
			threadId: randomUUID(),
			title: workflow.title,
			workflowId,
			messages: [],
		};

		const { finalContent, renderedBlocks, executionError } =
			yield* this.renderStructuredDefinition(
				definition,
				thread,
				workflowId,
				signal,
			);

		if (executionError || !finalContent) {
			await this.updateSlot(documentMemory, document, slotId, {
				status: "failed",
				error: executionError?.message ?? "No content produced",
			});
			if (executionError) {
				throw executionError;
			}
			return;
		}

		const fragment: DocumentFragment = {
			content: finalContent,
			blocks: renderedBlocks,
			source: { type: "WORKFLOW", workflowId },
			resolvedAt: new Date().toISOString(),
		};
		await this.updateSlot(documentMemory, document, slotId, {
			status: "resolved",
			fragment,
			error: undefined,
		});
	}

	/**
	 * Writes a partial update to a single slot and persists the document with a
	 * bumped version. Mutates the in-memory `document.slots` so subsequent
	 * updates in the same run build on the latest state.
	 */
	private async updateSlot(
		documentMemory: NonNullable<ReturnType<MemoryModule["getDocumentMemory"]>>,
		document: Document,
		slotId: string,
		patch: Partial<DocumentSlot>,
	): Promise<void> {
		const slots = (document.slots ?? []).map((slot) =>
			slot.slotId === slotId ? { ...slot, ...patch } : slot,
		);
		document.slots = slots;
		document.version += 1;
		document.updatedAt = new Date().toISOString();
		await documentMemory.updateDocument(document.documentId, {
			slots,
			version: document.version,
			updatedAt: document.updatedAt,
		});
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
			userId: workflow.userId,
			lastRunAt: Date.now(),
			lastThreadId: threadId,
		});
	}

	/**
	 * Resolves a slot binding's `workflowId` to a runnable workflow, accepting
	 * either a user workflow or a workflow template. User workflows take
	 * precedence; falls back to a template with the same id.
	 */
	private async getFillableWorkflow(
		workflowId: string,
	): Promise<UserWorkflow | WorkflowTemplate | undefined> {
		const userWorkflow = await this.userWorkflowService.getWorkflow(workflowId);
		if (userWorkflow) {
			return userWorkflow;
		}
		return this.memoryModule
			.getWorkflowTemplateMemory()
			.getTemplate(workflowId);
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
		await appendTextMessageToThread(
			this.memoryModule,
			thread,
			MessageRole.USER,
			title,
			{
				workflowId: workflow.workflowId,
				workflowRun: true,
				query: resolvedQuery,
			},
		);

		return thread;
	}
}
