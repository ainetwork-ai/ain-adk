import { WorkflowTemplateApiController } from "@/controllers/api/workflow-template.api.controller";
import type { MemoryModule } from "@/modules";
import type { WorkflowDefinition, WorkflowTemplate } from "@/types/memory";

function buildController(templates: WorkflowTemplate[]) {
	const memoryModule = {
		getWorkflowTemplateMemory: () => ({
			listTemplates: jest.fn(async () => templates),
		}),
	} as unknown as MemoryModule;
	return new WorkflowTemplateApiController(memoryModule);
}

function buildControllerWithTemplateMemory(templateMemory: {
	createTemplate?: jest.Mock;
	updateTemplate?: jest.Mock;
}) {
	const memoryModule = {
		getWorkflowTemplateMemory: () => templateMemory,
	} as unknown as MemoryModule;
	return new WorkflowTemplateApiController(memoryModule);
}

const validDefinition: WorkflowDefinition = {
	tasks: [{ taskId: "fetch", title: "조회", prompt: "데이터를 조회한다." }],
	response: { blocks: [] },
};

const invalidDefinition = {
	tasks: "not-an-array",
	response: { blocks: [] },
} as unknown as WorkflowDefinition;

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

describe("handleCreateTemplate", () => {
	it("rejects template creation without definition", async () => {
		const controller = buildController([]);
		const status = jest.fn().mockReturnThis();
		const next = jest.fn();
		await controller.handleCreateTemplate(
			{ body: { templateId: "t1", title: "제목", content: "c" } } as never,
			{ status, json: jest.fn(), send: jest.fn() } as never,
			next,
		);
		// AinHttpError는 `status` 프로퍼티를 쓴다 (src/types/agent.ts:43-49)
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({ status: 400 }),
		);
	});

	it("rejects template creation with a structurally invalid definition", async () => {
		const createTemplate = jest.fn();
		const controller = buildControllerWithTemplateMemory({ createTemplate });
		const status = jest.fn().mockReturnThis();
		const next = jest.fn();
		await controller.handleCreateTemplate(
			{
				body: {
					templateId: "t1",
					title: "제목",
					content: "c",
					definition: invalidDefinition,
				},
			} as never,
			{ status, json: jest.fn(), send: jest.fn() } as never,
			next,
		);
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({ status: 400 }),
		);
		expect(createTemplate).not.toHaveBeenCalled();
	});
});

describe("handleUpdateTemplate", () => {
	it("rejects update with definition: null", async () => {
		const updateTemplate = jest.fn();
		const controller = buildControllerWithTemplateMemory({ updateTemplate });
		const send = jest.fn();
		const status = jest.fn().mockReturnValue({ send });
		const next = jest.fn();
		await controller.handleUpdateTemplate(
			{ params: { id: "t1" }, body: { definition: null } } as never,
			{ status } as never,
			next,
		);
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({ status: 400 }),
		);
		expect(updateTemplate).not.toHaveBeenCalled();
	});

	it("rejects update with a structurally invalid definition", async () => {
		const updateTemplate = jest.fn();
		const controller = buildControllerWithTemplateMemory({ updateTemplate });
		const send = jest.fn();
		const status = jest.fn().mockReturnValue({ send });
		const next = jest.fn();
		await controller.handleUpdateTemplate(
			{
				params: { id: "t1" },
				body: { definition: invalidDefinition },
			} as never,
			{ status } as never,
			next,
		);
		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({ status: 400 }),
		);
		expect(updateTemplate).not.toHaveBeenCalled();
	});

	it("passes through updates without a definition key untouched", async () => {
		const updateTemplate = jest.fn(async () => undefined);
		const controller = buildControllerWithTemplateMemory({ updateTemplate });
		const send = jest.fn();
		const status = jest.fn().mockReturnValue({ send });
		const next = jest.fn();
		await controller.handleUpdateTemplate(
			{ params: { id: "t1" }, body: { title: "새 제목" } } as never,
			{ status } as never,
			next,
		);
		expect(next).not.toHaveBeenCalled();
		expect(updateTemplate).toHaveBeenCalledWith("t1", { title: "새 제목" });
		expect(status).toHaveBeenCalledWith(200);
		expect(send).toHaveBeenCalled();
	});

	it("accepts updates with a valid definition", async () => {
		const updateTemplate = jest.fn(async () => undefined);
		const controller = buildControllerWithTemplateMemory({ updateTemplate });
		const send = jest.fn();
		const status = jest.fn().mockReturnValue({ send });
		const next = jest.fn();
		await controller.handleUpdateTemplate(
			{
				params: { id: "t1" },
				body: { definition: validDefinition },
			} as never,
			{ status } as never,
			next,
		);
		expect(next).not.toHaveBeenCalled();
		expect(updateTemplate).toHaveBeenCalledWith("t1", {
			definition: validDefinition,
		});
		expect(status).toHaveBeenCalledWith(200);
	});
});
