import type { MemoryModule, ModelModule } from "@/modules";
import type { ToolCallingService } from "@/services/tool-calling.service";
import type { UserWorkflowService } from "@/services/user-workflow.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";
import { DocumentFormat, DocumentSource } from "@/types/document";
import { ThreadType } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";

const DEFINITION = {
	tasks: [{ taskId: "t1", title: "차트", prompt: "차트를 그린다" }],
	response: {
		blocks: [
			{ blockId: "b1", type: "text" as const, prompt: "요약", sourceTaskIds: ["t1"] },
		],
	},
};

const WORKFLOW = {
	workflowId: "wf-1",
	userId: "user-1",
	title: "리포트",
	content: "리포트",
	active: true,
	definition: DEFINITION,
};

const ARTIFACT = {
	kind: "artifact" as const,
	artifactId: "art-1",
	name: "chart.png",
	mimeType: "image/png",
};

const DOCUMENT = {
	documentId: "doc-1",
	userId: "user-1",
	title: "문서",
	format: DocumentFormat.MARKDOWN,
	content: "{{slot:s1}}",
	source: DocumentSource.MANUAL,
	version: 1,
	createdAt: "",
	updatedAt: "",
	slots: [
		{
			slotId: "s1",
			binding: { type: "WORKFLOW", workflowId: "wf-1" },
			status: "pending",
		},
	],
};

function build() {
	const addMessagesToThread = jest.fn(async () => undefined);
	const executeTask = jest.fn(async function* () {
		yield { event: "artifact_ready", data: ARTIFACT } as StreamEvent;
		return {
			taskId: "t1",
			title: "차트",
			status: "completed",
			content: "차트 생성",
			startedAt: 1,
			completedAt: 2,
		};
	});
	const service = new WorkflowExecutionService(
		{
			getWorkflow: jest.fn(async () => WORKFLOW),
			updateWorkflow: jest.fn(async () => undefined),
		} as unknown as UserWorkflowService,
		new WorkflowVariableResolver(),
		{} as ModelModule,
		{
			getThreadMemory: () => ({
				createThread: jest.fn(async () => ({
					type: ThreadType.WORKFLOW,
					userId: "user-1",
					threadId: "thread-1",
					title: "리포트",
					workflowId: "wf-1",
				})),
				addMessagesToThread,
			}),
			getDocumentMemory: () => ({
				getDocument: jest.fn(async () => DOCUMENT),
				updateDocumentSlot: jest.fn(async () => undefined),
				updateDocument: jest.fn(async () => undefined),
			}),
			getWorkflowTemplateMemory: () => ({
				getTemplate: jest.fn(async () => ({ ...WORKFLOW, templateId: "wf-1" })),
			}),
		} as unknown as MemoryModule,
		{} as ToolCallingService,
	);
	Object.assign(service, {
		workflowTaskRunner: { executeTask },
		workflowResponseComposer: {
			renderResponseBlock: async function* () {
				yield { event: "text_chunk", data: { delta: "요약" } };
				return { blockId: "b1", type: "text", content: "요약" };
			},
		},
	});
	return { service, addMessagesToThread, executeTask };
}

async function collect(stream: AsyncIterable<StreamEvent>) {
	const events: StreamEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("workflow tool artifacts", () => {
	// Without document memory the run persists an inline text message; the
	// artifact must ride on it, like fulfill's final message.
	it("attaches task artifacts to the persisted workflow message", async () => {
		const { service, addMessagesToThread, executeTask } = build();
		(service as unknown as { memoryModule: MemoryModule }).memoryModule = {
			...(service as unknown as { memoryModule: MemoryModule }).memoryModule,
			getDocumentMemory: () => undefined,
		} as unknown as MemoryModule;

		const events = await collect(service.executeWorkflowStream("wf-1"));

		// Last write is the response; the first is the run's user-query message.
		const saved = (addMessagesToThread.mock.calls.at(-1) as unknown[])[2] as Array<{
			parts: unknown[];
		}>;
		expect(saved[0].parts).toContainEqual(ARTIFACT);
		const complete = events.find((e) => e.event === "message_complete");
		expect(complete?.data).toMatchObject({
			message: { parts: expect.arrayContaining([ARTIFACT]) },
		});
		expect((executeTask.mock.calls[0] as unknown[])[3]).not.toMatchObject({
			storeArtifacts: false,
		});
	});

	it.each([
		[
			"template run",
			(s: WorkflowExecutionService) =>
				s.runTemplateStream("wf-1", { userId: "user-1" }),
		],
		[
			"slot fill",
			(s: WorkflowExecutionService) => s.fillDocumentSlotStream("doc-1", "s1"),
		],
		[
			"workflow advice",
			(s: WorkflowExecutionService) =>
				s.generateDocumentAdviceStream("doc-1", { workflowId: "wf-1" }),
		],
	])("does not store tool artifacts during %s (nothing to attach them to)", async (_, run) => {
		const { service, executeTask } = build();

		await collect(run(service));

		expect(executeTask).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			{ storeArtifacts: false },
		);
	});
});
