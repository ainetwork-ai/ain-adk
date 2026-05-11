import type { A2AModule, ModelModule } from "@/modules";
import { WorkflowTaskRunner } from "@/services/workflow-task-runner.service";
import { ThreadType, type WorkflowTaskResult } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import type { ToolCallingService } from "@/services/tool-calling.service";

async function collectGenerator<TYield, TReturn>(
	stream: AsyncGenerator<TYield, TReturn, unknown>,
): Promise<{ events: TYield[]; result: TReturn }> {
	const events: TYield[] = [];
	let next = await stream.next();
	while (!next.done) {
		events.push(next.value);
		next = await stream.next();
	}

	return { events, result: next.value };
}

async function* createEventStream(
	events: StreamEvent[],
	finalValue: string,
): AsyncGenerator<StreamEvent, string, unknown> {
	for (const event of events) {
		yield event;
	}

	return finalValue;
}

describe("WorkflowTaskRunner", () => {
	const thread = {
		userId: "user-1",
		threadId: "thread-1",
		type: ThreadType.WORKFLOW,
		title: "Workflow Thread",
		messages: [],
		workflowId: "workflow-1",
	};

	const taskResults: Record<string, WorkflowTaskResult> = {};

	it("emits local task output with task-specific events while keeping final text private", async () => {
		const modelModule = {
			getModel: () => ({
				generateMessages: jest.fn(() => []),
			}),
		} as unknown as ModelModule;
		const toolCallingService = {
			getTools: jest.fn(async () => []),
			run: jest.fn(() =>
				createEventStream(
					[
						{
							event: "thinking_process",
							data: {
								title: "local progress",
								description: "running local task",
							},
						},
						{
							event: "text_chunk",
							data: { delta: "secret task output" },
						},
					],
					"ignored final value",
				),
			),
		} as unknown as ToolCallingService;

		const runner = new WorkflowTaskRunner(modelModule, toolCallingService);
		const stream = runner.executeTask(
			{
				taskId: "task-1",
				title: "Collect data",
				prompt: "Find the data",
			},
			thread,
			taskResults,
		);

		const { events, result } = await collectGenerator(stream);

		expect(events).toEqual([
			{
				event: "thinking_process",
				data: expect.objectContaining({
					title: "[워크플로우] 작업 실행: Collect data",
				}),
			},
			{
				event: "thinking_process",
				data: {
					title: "local progress",
					description: "running local task",
				},
			},
			{
				event: "task_output",
				data: {
					taskId: "task-1",
					title: "Collect data",
					delta: "secret task output",
					agent: undefined,
				},
			},
			{
				event: "task_result",
				data: {
					taskId: "task-1",
					title: "Collect data",
					status: "completed",
					agent: undefined,
					error: undefined,
				},
			},
		]);
		expect(events.find((event) => event.event === "text_chunk")).toBeUndefined();
		expect(result.status).toBe("completed");
		expect(result.content).toBe("secret task output");
	});

	it("emits delegated task output with task-specific events while keeping final text private", async () => {
		const modelModule = {} as ModelModule;
		const toolCallingService = {} as ToolCallingService;
		const a2aModule = {
			hasConnector: jest.fn(() => true),
			sendTask: jest.fn(() =>
				createEventStream(
					[
						{
							event: "thinking_process",
							data: {
								title: "agent progress",
								description: "delegated task running",
							},
						},
						{
							event: "text_chunk",
							data: { delta: "delegated raw answer" },
						},
					],
					"ignored final value",
				),
			),
		} as unknown as A2AModule;

		const runner = new WorkflowTaskRunner(
			modelModule,
			toolCallingService,
			a2aModule,
		);
		const stream = runner.executeTask(
			{
				taskId: "task-2",
				title: "Delegate task",
				prompt: "Ask another agent",
				agent: {
					protocol: "A2A",
					connectorName: "delegate",
				},
			},
			thread,
			taskResults,
		);

		const { events, result } = await collectGenerator(stream);

		expect(events).toEqual([
			{
				event: "thinking_process",
				data: expect.objectContaining({
					title: "[워크플로우] 작업 실행: Delegate task",
				}),
			},
			{
				event: "thinking_process",
				data: {
					title: "agent progress",
					description: "delegated task running",
				},
			},
			{
				event: "task_output",
				data: {
					taskId: "task-2",
					title: "Delegate task",
					delta: "delegated raw answer",
					agent: "delegate",
				},
			},
			{
				event: "task_result",
				data: {
					taskId: "task-2",
					title: "Delegate task",
					status: "completed",
					agent: "delegate",
					error: undefined,
				},
			},
		]);
		expect(events.find((event) => event.event === "text_chunk")).toBeUndefined();
		expect(result.status).toBe("completed");
		expect(result.content).toBe("delegated raw answer");
	});
});
