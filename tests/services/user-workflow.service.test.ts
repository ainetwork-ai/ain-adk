import type { MemoryModule } from "@/modules";
import type { IUserWorkflowMemory } from "@/modules/memory/base.memory";
import type {
	UserWorkflow,
	WorkflowDefinition,
	WorkflowVariable,
} from "@/types/memory";
import { UserWorkflowService } from "@/services/user-workflow.service";
import type { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";

const minimalDefinition: WorkflowDefinition = {
	tasks: [{ taskId: "t1", title: "분석", prompt: "분석해줘" }],
	response: {
		blocks: [
			{ blockId: "b1", type: "text", prompt: "요약", sourceTaskIds: ["t1"] },
		],
	},
};

describe("UserWorkflowService", () => {
	it("defaults content to title when content is missing", async () => {
		const createUserWorkflow = jest.fn(
			async (workflow: UserWorkflow) => workflow,
		);
		const memory = {
			createUserWorkflow,
		} as unknown as IUserWorkflowMemory;
		const memoryModule = {
			getUserWorkflowMemory: () => memory,
		} as unknown as MemoryModule;
		const workflowVariableResolver = {
			normalizeVariables: jest.fn((variables) => variables),
			resolveForCreation: jest.fn((workflow: UserWorkflow) => ({
				content: workflow.content,
				title: workflow.title,
				definition: workflow.definition,
			})),
		} as unknown as WorkflowVariableResolver;

		const service = new UserWorkflowService(
			memoryModule,
			workflowVariableResolver,
		);

		const created = await service.createWorkflow({
			workflowId: "",
			userId: "user-1",
			title: "일일 매출 분석",
			content: "" as unknown as string,
			active: true,
			definition: minimalDefinition,
		});

		expect(workflowVariableResolver.resolveForCreation).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "일일 매출 분석",
				content: "일일 매출 분석",
			}),
		);
		expect(createUserWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "일일 매출 분석",
				content: "일일 매출 분석",
			}),
		);
		expect(created.content).toBe("일일 매출 분석");
	});

	it("normalizes dropdown variable types to select on create", async () => {
		const createUserWorkflow = jest.fn(
			async (workflow: UserWorkflow) => workflow,
		);
		const memory = {
			createUserWorkflow,
		} as unknown as IUserWorkflowMemory;
		const memoryModule = {
			getUserWorkflowMemory: () => memory,
		} as unknown as MemoryModule;
		const workflowVariableResolver = {
			normalizeVariables: jest.fn(
				(variables?: Record<string, WorkflowVariable>) =>
					variables
						? Object.fromEntries(
								Object.entries(variables).map(([key, variable]) => [
									key,
									{
										...variable,
										type:
											variable.type === "dropdown" ? "select" : variable.type,
									},
								]),
							)
						: undefined,
			),
			resolveForCreation: jest.fn((workflow: UserWorkflow) => ({
				content: workflow.content,
				title: workflow.title,
				definition: workflow.definition,
			})),
		} as unknown as WorkflowVariableResolver;

		const service = new UserWorkflowService(
			memoryModule,
			workflowVariableResolver,
		);

		await service.createWorkflow({
			workflowId: "",
			userId: "user-1",
			title: "업장 리포트",
			content: "업장 리포트",
			active: true,
			definition: minimalDefinition,
			variables: {
				store: {
					id: "store",
					label: "업장",
					type: "dropdown",
					options: ["A", "B"],
				},
			},
		});

		expect(workflowVariableResolver.normalizeVariables).toHaveBeenCalledWith({
			store: {
				id: "store",
				label: "업장",
				type: "dropdown",
				options: ["A", "B"],
			},
		});
		expect(createUserWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				variables: {
					store: expect.objectContaining({
						type: "select",
					}),
				},
			}),
		);
	});

	it("rejects creation when resolver returns no valid definition", async () => {
		const memoryModule = {
			getUserWorkflowMemory: () => ({ createUserWorkflow: jest.fn() }),
		} as unknown as MemoryModule;
		const resolver = {
			normalizeVariables: jest.fn((v) => v),
			resolveForCreation: jest.fn(() => ({
				content: "c",
				title: "t",
				definition: undefined, // validateWorkflowDefinition이 거부한 경우
			})),
		} as unknown as WorkflowVariableResolver;
		const service = new UserWorkflowService(memoryModule, resolver);

		await expect(
			service.createWorkflow({
				workflowId: "",
				userId: "u1",
				title: "t",
				content: "c",
				active: true,
				definition: { tasks: [], response: { blocks: [] } },
			}),
		).rejects.toThrow(/definition/i);
	});
});
