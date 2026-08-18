import type { MemoryModule, ModelModule } from "@/modules";
import type { ToolCallingService } from "@/services/tool-calling.service";
import type { UserWorkflowService } from "@/services/user-workflow.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { WorkflowVariableExtractionService } from "@/services/workflow-variable-extraction.service";
import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";
import { type ThreadObject, ThreadType } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";

const DEFINITION = {
	tasks: [{ taskId: "t1", prompt: "{{workplace}}의 {{period}} 매출을 조회한다" }],
	response: {
		blocks: [{ blockId: "b1", type: "text" as const, prompt: "요약한다" }],
	},
};

const USER_WORKFLOW = {
	workflowId: "wf-1",
	userId: "owner-1",
	title: "주간 리포트",
	content: "주간 리포트를 생성한다",
	active: true,
	definition: DEFINITION,
	variables: {
		workplace: {
			id: "workplace",
			label: "업장",
			type: "dropdown" as const,
			options: ["강남점", "판교점"],
		},
		period: { id: "period", label: "기간", type: "date_range" as const },
	},
	variableValues: { workplace: "판교점", period: "2026-01-01 ~ 2026-01-07" },
};

const CHAT_THREAD: ThreadObject = {
	type: ThreadType.CHAT,
	userId: "chat-user",
	threadId: "thread-1",
	title: "채팅",
	messages: [],
};

const SUBQUERY = "지난주 강남점 리포트 만들어줘";

function build(options?: { userWorkflow?: unknown; template?: unknown }) {
	const getTemplate = jest.fn(async () => options?.template);
	const service = new WorkflowExecutionService(
		{
			getWorkflow: jest.fn(async () => options?.userWorkflow),
		} as unknown as UserWorkflowService,
		new WorkflowVariableResolver(),
		{} as unknown as ModelModule,
		{
			getWorkflowTemplateMemory: () => ({ getTemplate }),
		} as unknown as MemoryModule,
		{} as unknown as ToolCallingService,
	);
	return { service, getTemplate };
}

function mockExtraction(result: Record<string, string> | undefined) {
	return jest
		.spyOn(WorkflowVariableExtractionService.prototype, "extractFromQuery")
		.mockResolvedValue(result);
}

function mockRender(
	service: WorkflowExecutionService,
	impl: () => Generator<StreamEvent, unknown, unknown>,
) {
	return jest
		.spyOn(service as never, "renderStructuredDefinition" as never)
		.mockImplementation(impl as never);
}

async function collect(stream: AsyncGenerator<StreamEvent>) {
	const events: StreamEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("executeIntentWorkflowStream", () => {
	afterEach(() => jest.restoreAllMocks());

	it("throws before yielding when no workflow or template matches", async () => {
		const { service } = build();
		await expect(
			collect(
				service.executeIntentWorkflowStream("missing", CHAT_THREAD, SUBQUERY),
			),
		).rejects.toThrow("User workflow or template not found: missing");
	});

	it("throws when the workflow has no structured definition", async () => {
		mockExtraction(undefined);
		const { service } = build({
			userWorkflow: { ...USER_WORKFLOW, definition: undefined },
		});
		await expect(
			collect(
				service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
			),
		).rejects.toThrow("no valid structured definition");
	});

	it("injects extracted variables into the definition (stored values as fallback)", async () => {
		const extractSpy = mockExtraction({ period: "2026-07-20 ~ 2026-07-26" });
		const { service } = build({ userWorkflow: USER_WORKFLOW });
		const renderSpy = mockRender(service, function* () {
			return { finalContent: "", renderedBlocks: [] };
		});

		await collect(
			service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
		);

		expect(extractSpy).toHaveBeenCalledWith(
			expect.objectContaining({ workplace: expect.anything() }),
			SUBQUERY,
			undefined,
		);
		const [definition] = renderSpy.mock.calls[0] as unknown as [
			{ tasks: Array<{ prompt: string }> },
		];
		// period는 추출값, workplace는 저장된 variableValues 기본값으로 삽입된다
		expect(definition.tasks[0].prompt).toBe(
			"판교점의 2026-07-20 ~ 2026-07-26 매출을 조회한다",
		);
	});

	it("runs the definition on an ephemeral thread owned by the chat user", async () => {
		mockExtraction(undefined);
		const { service } = build({ userWorkflow: USER_WORKFLOW });
		const renderSpy = mockRender(service, function* () {
			yield { event: "text_chunk", data: { delta: "결과" } } as StreamEvent;
			return { finalContent: "결과", renderedBlocks: [] };
		});

		const events = await collect(
			service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
		);

		expect(events).toEqual([{ event: "text_chunk", data: { delta: "결과" } }]);
		const [, thread, workflowId] = renderSpy.mock.calls[0] as unknown as [
			unknown,
			ThreadObject,
			string,
		];
		expect(thread).toMatchObject({
			type: ThreadType.WORKFLOW,
			userId: "chat-user",
			workflowId: "wf-1",
			messages: [],
		});
		expect(workflowId).toBe("wf-1");
	});

	it("skips extraction for workflows without variables", async () => {
		const extractSpy = mockExtraction(undefined);
		const { service } = build({
			userWorkflow: {
				...USER_WORKFLOW,
				variables: undefined,
				variableValues: undefined,
				definition: {
					tasks: [{ taskId: "t1", prompt: "매출을 조회한다" }],
					response: DEFINITION.response,
				},
			},
		});
		mockRender(service, function* () {
			return { finalContent: "", renderedBlocks: [] };
		});
		await collect(
			service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
		);
		expect(extractSpy).not.toHaveBeenCalled();
	});

	it("falls back to a template when no user workflow matches", async () => {
		mockExtraction(undefined);
		const { service, getTemplate } = build({
			template: { ...USER_WORKFLOW, templateId: "wf-1" },
		});
		mockRender(service, function* () {
			return { finalContent: "", renderedBlocks: [] };
		});
		await collect(
			service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
		);
		expect(getTemplate).toHaveBeenCalledWith("wf-1");
	});

	it("rethrows executionError after streaming", async () => {
		mockExtraction(undefined);
		const { service } = build({ userWorkflow: USER_WORKFLOW });
		mockRender(service, function* () {
			yield { event: "text_chunk", data: { delta: "부분" } } as StreamEvent;
			return {
				finalContent: "부분",
				renderedBlocks: [],
				executionError: new Error("task failed"),
			};
		});
		await expect(
			collect(
				service.executeIntentWorkflowStream("wf-1", CHAT_THREAD, SUBQUERY),
			),
		).rejects.toThrow("task failed");
	});
});
