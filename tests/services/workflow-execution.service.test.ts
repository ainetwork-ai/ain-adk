import type { MemoryModule, ModelModule } from "@/modules";
import type { QueryService } from "@/services/query.service";
import type { ToolCallingService } from "@/services/tool-calling.service";
import type { UserWorkflowService } from "@/services/user-workflow.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
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
	it("executes legacy workflows through the text-first query boundary", async () => {
		const workflow = {
			workflowId: "workflow-1",
			userId: "user-1",
			title: "Daily report",
			content: "Summarize performance",
			active: true,
		};
		const userWorkflowService = {
			getWorkflow: jest.fn(async () => workflow),
			updateWorkflow: jest.fn(async () => undefined),
		} as unknown as UserWorkflowService;
		const handleQuery = jest.fn(async function* () {
			yield {
				event: "thread_id",
				data: {
					type: ThreadType.WORKFLOW,
					userId: "user-1",
					threadId: "thread-1",
					title: "Daily report",
					workflowId: "workflow-1",
				},
			} satisfies StreamEvent;
		});
		const queryService = { handleQuery } as unknown as QueryService;
		const workflowVariableResolver = {
			resolveForExecution: jest.fn(() => ({
				query: "Summarize performance",
				displayQuery: "Daily report",
				definition: undefined,
			})),
		} as unknown as WorkflowVariableResolver;

		const service = new WorkflowExecutionService(
			userWorkflowService,
			queryService,
			workflowVariableResolver,
			{} as ModelModule,
			{} as MemoryModule,
			{} as ToolCallingService,
		);

		await expect(service.executeWorkflow("workflow-1")).resolves.toEqual({
			content: "",
			threadId: "thread-1",
		});
		expect(handleQuery).toHaveBeenCalledWith(
			{
				type: ThreadType.WORKFLOW,
				userId: "user-1",
				workflowId: "workflow-1",
				title: "Daily report",
			},
			{
				query: "Summarize performance",
				displayQuery: "Daily report",
			},
		);
		expect(userWorkflowService.updateWorkflow).toHaveBeenCalledWith(
			"workflow-1",
			{
				userId: "user-1",
				lastRunAt: expect.any(Number),
				lastThreadId: "thread-1",
			},
		);
	});

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
		} as unknown as MemoryModule;

		const service = new WorkflowExecutionService(
			userWorkflowService,
			queryService,
			workflowVariableResolver,
			{} as ModelModule,
			memoryModule,
			{} as ToolCallingService,
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
});
