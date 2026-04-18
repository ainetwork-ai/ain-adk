import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { ThreadType } from "@/types/memory";

describe("WorkflowExecutionService", () => {
	it("executes workflows through the text-first query boundary", async () => {
		const getWorkflow = jest.fn(async () => ({
			workflowId: "workflow-1",
			userId: "user-1",
			title: "Daily report",
			content: "Summarize performance",
			active: true,
		}));
		const updateWorkflow = jest.fn(async () => {});
		const resolveForExecution = jest.fn(() => ({
			query: "Summarize performance",
			displayQuery: "Daily report",
		}));
		const handleQuery = jest.fn(async function* () {
			yield {
				event: "thread_id" as const,
				data: {
					type: ThreadType.WORKFLOW,
					userId: "user-1",
					threadId: "thread-1",
					title: "Daily report",
					workflowId: "workflow-1",
				},
			};
			return undefined;
		});

		const service = new WorkflowExecutionService(
			{
				getWorkflow,
				updateWorkflow,
			} as any,
			{
				handleQuery,
			} as any,
			{
				resolveForExecution,
			} as any,
		);

		await expect(service.executeWorkflow("workflow-1")).resolves.toEqual({
			threadId: "thread-1",
		});

		expect(resolveForExecution).toHaveBeenCalledWith(
			expect.objectContaining({
				workflowId: "workflow-1",
			}),
			undefined,
		);
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
				input: undefined,
			},
		);
		expect(updateWorkflow).toHaveBeenCalledWith("workflow-1", {
			lastRunAt: expect.any(Number),
			lastThreadId: "thread-1",
		});
	});

	it("preserves the workflow execution input shape for future structured input support", async () => {
		const handleQuery = jest.fn(async function* () {
			yield {
				event: "thread_id" as const,
				data: {
					type: ThreadType.WORKFLOW,
					userId: "user-1",
					threadId: "thread-2",
					title: "Daily report",
					workflowId: "workflow-1",
				},
			};
			return undefined;
		});

		const service = new WorkflowExecutionService(
			{
				getWorkflow: async () => ({
					workflowId: "workflow-1",
					userId: "user-1",
					title: "Daily report",
					content: "Summarize performance",
					active: true,
				}),
				updateWorkflow: jest.fn(async () => {}),
			} as any,
			{
				handleQuery,
			} as any,
			{
				resolveForExecution: jest.fn(() => ({
					query: "Summarize performance",
					displayQuery: "Daily report",
					input: {
						parts: [{ kind: "text", text: "future workflow input" }],
					},
				})),
			} as any,
		);

		await service.executeWorkflow("workflow-1");

		expect(handleQuery).toHaveBeenCalledWith(
			expect.any(Object),
			{
				query: "Summarize performance",
				displayQuery: "Daily report",
				input: {
					parts: [{ kind: "text", text: "future workflow input" }],
				},
			},
		);
	});
});
