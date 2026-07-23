import { WorkflowTemplateApiController } from "@/controllers/api/workflow-template.api.controller";
import type { MemoryModule } from "@/modules";
import type { WorkflowTemplate } from "@/types/memory";

function buildController(templates: WorkflowTemplate[]) {
	const memoryModule = {
		getWorkflowTemplateMemory: () => ({
			listTemplates: jest.fn(async () => templates),
		}),
	} as unknown as MemoryModule;
	return new WorkflowTemplateApiController(memoryModule);
}

const visible = { templateId: "t1", title: "매출 분석" } as WorkflowTemplate;
const hiddenTemplate = {
	templateId: "t2",
	title: "advice 전용",
	hidden: true,
} as WorkflowTemplate;

describe("handleGetAllTemplates", () => {
	it("excludes hidden templates by default", async () => {
		const controller = buildController([visible, hiddenTemplate]);
		const json = jest.fn();
		await controller.handleGetAllTemplates(
			{ query: {} } as never,
			{ json } as never,
			jest.fn(),
		);
		expect(json).toHaveBeenCalledWith([visible]);
	});

	it("includes hidden templates when includeHidden=true", async () => {
		const controller = buildController([visible, hiddenTemplate]);
		const json = jest.fn();
		await controller.handleGetAllTemplates(
			{ query: { includeHidden: "true" } } as never,
			{ json } as never,
			jest.fn(),
		);
		expect(json).toHaveBeenCalledWith([visible, hiddenTemplate]);
	});
});
