import { DocumentApiController } from "@/controllers/api/document.api.controller";
import type { MemoryModule } from "@/modules";
import type { DocumentAdviceService } from "@/services/document-advice.service";
import type { SchedulerService } from "@/services/scheduler.service";
import type { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { streamEventsToSSE } from "@/utils/sse-stream";

jest.mock("@/utils/sse-stream", () => ({
	streamEventsToSSE: jest.fn(async () => {}),
}));

function build() {
	const memoryModule = {
		getDocumentMemory: () => ({
			getDocument: jest.fn(async () => ({ documentId: "d1", userId: "u1" })),
		}),
	} as unknown as MemoryModule;
	const workflowExecutionService = {
		generateDocumentAdviceStream: jest.fn(),
	} as unknown as WorkflowExecutionService;
	const documentAdviceService = {
		generateAdviceStream: jest.fn(),
	} as unknown as DocumentAdviceService;
	const controller = new DocumentApiController(
		memoryModule,
		workflowExecutionService,
		documentAdviceService,
		{} as unknown as SchedulerService,
	);
	return { controller, workflowExecutionService, documentAdviceService };
}

async function invoke(controller: DocumentApiController, body: object) {
	const req = { params: { id: "d1" }, body } as never;
	const res = { locals: { userId: "u1" } } as never;
	await controller.handleGenerateAdviceStream(req, res);
	// setup 콜백을 직접 실행해 분기를 검증
	const options = (streamEventsToSSE as jest.Mock).mock.calls.at(-1)?.[2];
	await options.setup(new AbortController().signal);
}

describe("handleGenerateAdviceStream routing", () => {
	beforeEach(() => jest.clearAllMocks());

	it("routes to workflow execution when adviceWorkflowId is present", async () => {
		const { controller, workflowExecutionService, documentAdviceService } =
			build();
		await invoke(controller, {
			adviceWorkflowId: "wf-1",
			executionVariables: { period: "2026-07" },
		});
		expect(
			workflowExecutionService.generateDocumentAdviceStream,
		).toHaveBeenCalledWith(
			"d1",
			{ workflowId: "wf-1", executionVariables: { period: "2026-07" } },
			expect.anything(),
		);
		expect(documentAdviceService.generateAdviceStream).not.toHaveBeenCalled();
	});

	it("falls back to single-inference advice when adviceWorkflowId is absent", async () => {
		const { controller, workflowExecutionService, documentAdviceService } =
			build();
		await invoke(controller, { advicePrompt: "프롬프트" });
		expect(documentAdviceService.generateAdviceStream).toHaveBeenCalledWith(
			"d1",
			{ advicePrompt: "프롬프트" },
			expect.anything(),
		);
		expect(
			workflowExecutionService.generateDocumentAdviceStream,
		).not.toHaveBeenCalled();
	});
});
