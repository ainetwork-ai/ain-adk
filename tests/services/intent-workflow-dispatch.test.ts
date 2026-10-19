import { setManifest } from "@/config/manifest";
import type { MemoryModule, ModelModule } from "@/modules";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import type { ToolCallingService } from "@/services/tool-calling.service";
import type { UserWorkflowService } from "@/services/user-workflow.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { WorkflowVariableExtractionService } from "@/services/workflow-variable-extraction.service";
import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";
import {
	type ThreadObject,
	ThreadType,
	type TriggeredIntent,
} from "@/types/memory";
import type { StreamEvent } from "@/types/stream";

const THREAD: ThreadObject = {
	type: ThreadType.CHAT,
	userId: "chat-user",
	threadId: "thread-1",
	title: "채팅",
	messages: [],
};

const BASE_INTENT = {
	id: "intent-1",
	name: "weekly-report",
	description: "주간 리포트 요청",
	status: "active",
	prompt: "리포트를 작성해줘",
};

const SUBQUERY = "이번 주 리포트 만들어줘";

function build() {
	const workflowExecutionService = {
		executeIntentWorkflowStream: jest.fn(),
	} as unknown as WorkflowExecutionService;
	const service = new IntentFulfillService(
		{} as unknown as ModelModule,
		{} as unknown as MemoryModule,
		{} as unknown as ToolCallingService,
		undefined,
		undefined,
		workflowExecutionService,
	);
	const promptSpy = jest
		.spyOn(service as never, "intentFulfilling" as never)
		.mockImplementation(async function* () {
			yield { event: "text_chunk", data: { delta: "프롬프트 응답" } };
		} as never);
	return { service, workflowExecutionService, promptSpy };
}

function getStream(
	service: IntentFulfillService,
	triggeredIntent: TriggeredIntent,
) {
	return (
		service as unknown as {
			getIntentStream: (
				t: TriggeredIntent,
				thread: ThreadObject,
			) => AsyncGenerator<StreamEvent>;
		}
	).getIntentStream(triggeredIntent, THREAD);
}

async function collect(stream: AsyncGenerator<StreamEvent>) {
	const events: StreamEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("getIntentStream workflow dispatch", () => {
	afterEach(() => jest.restoreAllMocks());

	it("routes to the workflow engine with the subquery when intent.workflowId is set", async () => {
		const { service, workflowExecutionService, promptSpy } = build();
		(
			workflowExecutionService.executeIntentWorkflowStream as jest.Mock
		).mockImplementation(async function* () {
			yield { event: "text_chunk", data: { delta: "워크플로우 응답" } };
		});

		const events = await collect(
			getStream(service, {
				subquery: SUBQUERY,
				intent: { ...BASE_INTENT, workflowId: "wf-1" },
			}),
		);

		expect(
			workflowExecutionService.executeIntentWorkflowStream,
		).toHaveBeenCalledWith("wf-1", THREAD, SUBQUERY);
		expect(promptSpy).not.toHaveBeenCalled();
		expect(events).toEqual([
			{ event: "text_chunk", data: { delta: "워크플로우 응답" } },
		]);
	});

	it("keeps the prompt path when workflowId is absent", async () => {
		const { service, workflowExecutionService, promptSpy } = build();
		const events = await collect(
			getStream(service, {
				subquery: SUBQUERY,
				intent: { ...BASE_INTENT },
			}),
		);
		expect(
			workflowExecutionService.executeIntentWorkflowStream,
		).not.toHaveBeenCalled();
		expect(promptSpy).toHaveBeenCalled();
		expect(events).toEqual([
			{ event: "text_chunk", data: { delta: "프롬프트 응답" } },
		]);
	});

	it("falls back to the prompt path when the workflow fails before yielding", async () => {
		const { service, workflowExecutionService } = build();
		(
			workflowExecutionService.executeIntentWorkflowStream as jest.Mock
		).mockImplementation(async function* () {
			throw new Error("User workflow or template not found: wf-1");
		});

		const events = await collect(
			getStream(service, {
				subquery: SUBQUERY,
				intent: { ...BASE_INTENT, workflowId: "wf-1" },
			}),
		);

		expect(events).toEqual([
			{ event: "text_chunk", data: { delta: "프롬프트 응답" } },
		]);
	});

	it("rethrows when the workflow fails after streaming started", async () => {
		const { service, workflowExecutionService, promptSpy } = build();
		(
			workflowExecutionService.executeIntentWorkflowStream as jest.Mock
		).mockImplementation(async function* () {
			yield { event: "text_chunk", data: { delta: "부분 결과" } };
			throw new Error("task failed");
		});

		await expect(
			collect(
				getStream(service, {
					subquery: SUBQUERY,
					intent: { ...BASE_INTENT, workflowId: "wf-1" },
				}),
			),
		).rejects.toThrow("task failed");
		expect(promptSpy).not.toHaveBeenCalled();
	});

	it("uses prompt path when workflowExecutionService is not wired", async () => {
		const service = new IntentFulfillService(
			{} as unknown as ModelModule,
			{} as unknown as MemoryModule,
			{} as unknown as ToolCallingService,
			undefined,
			undefined,
		);
		const promptSpy = jest
			.spyOn(service as never, "intentFulfilling" as never)
			.mockImplementation(async function* () {
				yield { event: "text_chunk", data: { delta: "프롬프트 응답" } };
			} as never);

		const events = await collect(
			getStream(service, {
				subquery: SUBQUERY,
				intent: { ...BASE_INTENT, workflowId: "wf-1" },
			}),
		);

		expect(promptSpy).toHaveBeenCalled();
		expect(events).toEqual([
			{ event: "text_chunk", data: { delta: "프롬프트 응답" } },
		]);
	});
});

// Un-mocked dispatch: the real workflow engine renders its own canonical
// message_start/part_delta. The fulfill boundary owns message identity, so
// the client must see exactly one message, not the inner one plus a re-wrap.
describe("intent → workflow canonical stream identity", () => {
	afterEach(() => jest.restoreAllMocks());

	it("emits a single canonical message for an intent-mapped workflow", async () => {
		setManifest({ name: "Test Agent", description: "Test agent" });
		jest
			.spyOn(WorkflowVariableExtractionService.prototype, "extractFromQuery")
			.mockResolvedValue(undefined);
		const workflowExecutionService = new WorkflowExecutionService(
			{
				getWorkflow: jest.fn(async () => ({
					workflowId: "wf-1",
					userId: "owner-1",
					title: "주간 리포트",
					content: "주간 리포트",
					active: true,
					definition: {
						tasks: [{ taskId: "t1", title: "분석", prompt: "분석해줘" }],
						response: {
							blocks: [
								{
									blockId: "b1",
									type: "text",
									prompt: "요약",
									sourceTaskIds: ["t1"],
								},
							],
						},
					},
				})),
			} as unknown as UserWorkflowService,
			new WorkflowVariableResolver(),
			{} as unknown as ModelModule,
			{} as unknown as MemoryModule,
			{} as unknown as ToolCallingService,
		);
		Object.assign(workflowExecutionService, {
			workflowTaskRunner: {
				executeTask: async function* () {
					return {
						taskId: "t1",
						title: "분석",
						status: "completed",
						content: "분석 결과",
						startedAt: 1,
						completedAt: 2,
					};
				},
			},
			workflowResponseComposer: {
				renderResponseBlock: async function* () {
					yield { event: "text_chunk", data: { delta: "요약 " } };
					yield { event: "text_chunk", data: { delta: "본문" } };
					return { blockId: "b1", type: "text", content: "요약 본문" };
				},
			},
		});
		const fulfill = new IntentFulfillService(
			{} as unknown as ModelModule,
			{
				getThreadMemory: () => ({ addMessagesToThread: jest.fn() }),
			} as unknown as MemoryModule,
			{} as unknown as ToolCallingService,
			undefined,
			undefined,
			workflowExecutionService,
		);

		const events = await collect(
			fulfill.intentFulfill(
				[{ subquery: SUBQUERY, intent: { ...BASE_INTENT, workflowId: "wf-1" } }],
				{ ...THREAD, messages: [] },
				SUBQUERY,
				false,
			),
		);

		const canonical = events.filter(
			(e) =>
				e.event === "message_start" ||
				e.event === "part_delta" ||
				e.event === "message_complete",
		);
		const ids = new Set(
			canonical.map((e) =>
				e.event === "message_complete"
					? e.data.message.messageId
					: (e.data as { messageId: string }).messageId,
			),
		);
		expect(ids.size).toBe(1);
		expect(canonical.map((e) => e.event)).toEqual([
			"message_start",
			"part_delta",
			"part_delta",
			"message_complete",
		]);
		expect(events.filter((e) => e.event === "text_chunk")).toHaveLength(2);
	});
});
