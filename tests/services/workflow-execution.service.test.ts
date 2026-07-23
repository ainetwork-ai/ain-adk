import type { MemoryModule, ModelModule } from "@/modules";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
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
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
			resolveForDocumentFill: jest.fn(() => ({
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
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
			resolveForDocumentFill: jest.fn(() => ({
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

	it("fills a document slot from its bound workflow without creating a thread", async () => {
		const workflow = {
			workflowId: "workflow-1",
			userId: "user-1",
			title: "Revenue",
			content: "Revenue",
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
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
			resolveForDocumentFill: jest.fn(() => ({
				query: workflow.content,
				displayQuery: workflow.title,
				definition: workflow.definition,
			})),
		} as unknown as WorkflowVariableResolver;

		const document = {
			documentId: "doc-1",
			userId: "user-1",
			title: "Monthly Report",
			format: "MARKDOWN",
			content: "## 매출\n{{slot:revenue}}\n",
			version: 1,
			source: "MANUAL",
			slots: [
				{
					slotId: "revenue",
					status: "empty",
					binding: { type: "WORKFLOW", workflowId: "workflow-1" },
				},
			],
			createdAt: "t0",
			updatedAt: "t0",
		};
		const createThread = jest.fn();
		const updateDocumentSlot = jest.fn(async () => undefined);
		const memoryModule = {
			getThreadMemory: () => ({ createThread }),
			getDocumentMemory: () => ({
				getDocument: jest.fn(async () => document),
				updateDocumentSlot,
			}),
		} as unknown as MemoryModule;
		const modelModule = {} as ModelModule;
		const toolCallingService = {} as ToolCallingService;

		const service = new WorkflowExecutionService(
			userWorkflowService,
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
				return { blockId: "block-1", type: "heading", content: "## Summary\n\n" };
			},
		};

		const events = await collectEvents(
			service.fillDocumentSlotStream("doc-1", "revenue"),
		);

		// No thread is created for slot fills.
		expect(createThread).not.toHaveBeenCalled();

		// Emits a document_id event identifying the target slot.
		expect(events).toContainEqual({
			event: "document_id",
			data: { documentId: "doc-1", slotId: "revenue" },
		});

		// Last slot update patches the target slot with the resolved fragment.
		const lastUpdate =
			updateDocumentSlot.mock.calls[updateDocumentSlot.mock.calls.length - 1];
		expect(lastUpdate[0]).toBe("doc-1");
		expect(lastUpdate[1]).toBe("revenue");
		const patch = lastUpdate[2] as any;
		expect(patch.status).toBe("resolved");
		expect(patch.fragment).toMatchObject({
			content: "## Summary\n\n",
			source: { type: "WORKFLOW", workflowId: "workflow-1" },
		});
	});

	it("fills a document slot from a bound workflow template when no user workflow matches", async () => {
		const template = {
			templateId: "template-1",
			title: "Revenue",
			description: "",
			active: true,
			content: "Revenue",
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
		// No user workflow with this id → must fall back to the template.
		const userWorkflowService = {
			getWorkflow: jest.fn(async () => undefined),
			updateWorkflow: jest.fn(async () => undefined),
		} as unknown as UserWorkflowService;
		const getTemplate = jest.fn(async () => template);
		const resolveForDocumentFill = jest.fn(() => ({
			query: template.content,
			displayQuery: template.title,
			definition: template.definition,
		}));
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(),
			resolveForDocumentFill,
		} as unknown as WorkflowVariableResolver;

		const document = {
			documentId: "doc-1",
			userId: "user-1",
			title: "Monthly Report",
			format: "MARKDOWN",
			content: "## 매출\n{{slot:revenue}}\n",
			version: 1,
			source: "MANUAL",
			slots: [
				{
					slotId: "revenue",
					status: "empty",
					binding: { type: "WORKFLOW", workflowId: "template-1" },
				},
			],
			createdAt: "t0",
			updatedAt: "t0",
		};
		const updateDocumentSlot = jest.fn(async () => undefined);
		const memoryModule = {
			getThreadMemory: () => ({ createThread: jest.fn() }),
			getWorkflowTemplateMemory: () => ({ getTemplate }),
			getDocumentMemory: () => ({
				getDocument: jest.fn(async () => document),
				updateDocumentSlot,
			}),
		} as unknown as MemoryModule;

		const service = new WorkflowExecutionService(
			userWorkflowService,
			workflowVariableResolver,
			{} as ModelModule,
			memoryModule,
			{} as ToolCallingService,
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
				return { blockId: "block-1", type: "heading", content: "## Summary\n\n" };
			},
		};

		const events = await collectEvents(
			service.fillDocumentSlotStream("doc-1", "revenue"),
		);

		// Looked up the template after the user-workflow lookup missed.
		expect(getTemplate).toHaveBeenCalledWith("template-1");
		expect(resolveForDocumentFill).toHaveBeenCalled();

		expect(events).toContainEqual({
			event: "document_id",
			data: { documentId: "doc-1", slotId: "revenue" },
		});

		const lastUpdate =
			updateDocumentSlot.mock.calls[updateDocumentSlot.mock.calls.length - 1];
		expect(lastUpdate[1]).toBe("revenue");
		const patch = lastUpdate[2] as any;
		expect(patch.status).toBe("resolved");
		expect(patch.fragment).toMatchObject({
			content: "## Summary\n\n",
			source: { type: "WORKFLOW", workflowId: "template-1" },
		});
	});

	it("throws when the workflow has no valid structured definition", async () => {
		const userWorkflowService = {
			getWorkflow: jest.fn(async () => ({
				workflowId: "w1",
				userId: "u1",
				title: "레거시",
				content: "옛날 프롬프트",
				active: true,
			})),
		} as unknown as UserWorkflowService;
		const resolver = {
			resolveForExecution: jest.fn(() => ({
				query: "옛날 프롬프트",
				displayQuery: "레거시",
				definition: undefined,
			})),
		} as unknown as WorkflowVariableResolver;
		const service = new WorkflowExecutionService(
			userWorkflowService,
			resolver,
			{} as unknown as ModelModule,
			{} as unknown as MemoryModule,
			{} as unknown as ToolCallingService,
		);

		const stream = service.executeWorkflowStream("w1");
		await expect(stream.next()).rejects.toThrow(
			/no valid structured definition/,
		);
	});
});
