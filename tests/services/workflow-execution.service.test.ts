import type { MemoryModule, ModelModule } from "@/modules";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import type { QueryService } from "@/services/query.service";
import type { ToolCallingService } from "@/services/tool-calling.service";
import type { UserWorkflowService } from "@/services/user-workflow.service";
import type { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";
import { ThreadType, type WorkflowTaskResult } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";

async function collectEvents<T>(
	stream: AsyncGenerator<T, unknown, unknown>,
): Promise<T[]> {
	const events: T[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("WorkflowExecutionService", () => {
	it("suppresses unexpected task text chunks until response rendering starts", async () => {
		const workflow = {
			workflowId: "workflow-1",
			userId: "user-1",
			title: "Daily Report",
			content: "Daily Report",
			active: true,
			definition: {
				tasks: [
					{
						taskId: "task-1",
						title: "Collect data",
						prompt: "Collect data",
					},
				],
				response: {
					blocks: [
						{
							blockId: "block-1",
							type: "heading" as const,
							text: "Summary",
						},
					],
				},
			},
		};
		const userWorkflowService = {
			getWorkflow: jest.fn(async () => workflow),
			updateWorkflow: jest.fn(async () => undefined),
		} as unknown as UserWorkflowService;
		const queryService = {} as QueryService;
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
		} as unknown as WorkflowVariableResolver;
		const memoryModule = {
			getThreadMemory: () => ({
				createThread: jest.fn(async () => ({
					type: ThreadType.WORKFLOW,
					userId: workflow.userId,
					threadId: "thread-1",
					title: workflow.title,
					workflowId: workflow.workflowId,
				})),
				addMessagesToThread: jest.fn(async () => undefined),
			}),
			getDocumentMemory: () => undefined,
		} as unknown as MemoryModule;
		const modelModule = {} as ModelModule;
		const toolCallingService = {} as ToolCallingService;

		const service = new WorkflowExecutionService(
			userWorkflowService,
			queryService,
			workflowVariableResolver,
			modelModule,
			memoryModule,
			toolCallingService,
		);

		(service as any).workflowTaskRunner = {
			executeTask: async function* () {
				yield {
					event: "thinking_process",
					data: {
						title: "task thinking",
						description: "running task",
					},
				} satisfies StreamEvent;
				yield {
					event: "text_chunk",
					data: { delta: "unexpected early text" },
				} satisfies StreamEvent;
				yield {
					event: "task_result",
					data: {
						taskId: "task-1",
						title: "Collect data",
						status: "completed",
					},
				} satisfies StreamEvent;

				return {
					taskId: "task-1",
					title: "Collect data",
					status: "completed",
					content: "task result body",
					startedAt: 1,
					completedAt: 2,
				} satisfies WorkflowTaskResult;
			},
		};
		(service as any).workflowResponseComposer = {
			renderResponseBlock: async function* () {
				yield {
					event: "text_chunk",
					data: { delta: "## Summary\n\n" },
				} satisfies StreamEvent;
				return {
					blockId: "block-1",
					type: "heading",
					content: "## Summary\n\n",
				};
			},
		};

		const events = await collectEvents(
			service.executeWorkflowStream(workflow.workflowId),
		);

		expect(events.map((event) => event.event)).toEqual([
			"thread_id",
			"thinking_process",
			"thinking_process",
			"task_result",
			"thinking_process",
			"text_chunk",
		]);
		expect(
			events.find(
				(event) =>
					event.event === "text_chunk" &&
					event.data.delta === "unexpected early text",
			),
		).toBeUndefined();
	});

	it("creates a document and appends a rich reference message when document memory is available", async () => {
		const workflow = {
			workflowId: "workflow-1",
			userId: "user-1",
			title: "Daily Report",
			content: "Daily Report",
			active: true,
			definition: {
				tasks: [
					{ taskId: "task-1", title: "Collect data", prompt: "Collect data" },
				],
				response: {
					blocks: [
						{ blockId: "block-1", type: "heading" as const, text: "Summary" },
					],
				},
			},
		};
		const userWorkflowService = {
			getWorkflow: jest.fn(async () => workflow),
			updateWorkflow: jest.fn(async () => undefined),
		} as unknown as UserWorkflowService;
		const queryService = {} as QueryService;
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
		} as unknown as WorkflowVariableResolver;

		const addMessagesToThread = jest.fn(async () => undefined);
		const createDocument = jest.fn(async (doc) => doc);
		const memoryModule = {
			getThreadMemory: () => ({
				createThread: jest.fn(async () => ({
					type: ThreadType.WORKFLOW,
					userId: workflow.userId,
					threadId: "thread-1",
					title: workflow.title,
					workflowId: workflow.workflowId,
				})),
				addMessagesToThread,
			}),
			getDocumentMemory: () => ({ createDocument }),
		} as unknown as MemoryModule;
		const modelModule = {} as ModelModule;
		const toolCallingService = {} as ToolCallingService;

		const service = new WorkflowExecutionService(
			userWorkflowService,
			queryService,
			workflowVariableResolver,
			modelModule,
			memoryModule,
			toolCallingService,
		);

		(service as any).workflowTaskRunner = {
			executeTask: async function* () {
				return {
					taskId: "task-1",
					title: "Collect data",
					status: "completed",
					content: "task result body",
					startedAt: 1,
					completedAt: 2,
				} satisfies WorkflowTaskResult;
			},
		};
		(service as any).workflowResponseComposer = {
			renderResponseBlock: async function* () {
				yield {
					event: "text_chunk",
					data: { delta: "## Summary\n\n" },
				} satisfies StreamEvent;
				return {
					blockId: "block-1",
					type: "heading",
					content: "## Summary\n\n",
				};
			},
		};

		await collectEvents(service.executeWorkflowStream(workflow.workflowId));

		expect(createDocument).toHaveBeenCalledTimes(1);
		const createdDoc = createDocument.mock.calls[0][0];
		expect(createdDoc).toMatchObject({
			userId: "user-1",
			source: "WORKFLOW",
			format: "MARKDOWN",
			content: "## Summary\n\n",
			version: 1,
			workflowId: "workflow-1",
			threadId: "thread-1",
		});

		// Find the rich reference message appended for the document.
		const richCall = addMessagesToThread.mock.calls.find(
			(call: any[]) => call[2]?.[0]?.content?.type === "rich",
		);
		expect(richCall).toBeDefined();
		const richMessage = (richCall as any[])[2][0];
		expect(richMessage.content.parts).toEqual([
			{
				type: "document",
				documentId: createdDoc.documentId,
				title: "Daily Report",
			},
		]);
	});
});
