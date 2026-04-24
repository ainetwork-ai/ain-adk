import type { MemoryModule } from "../modules";
import type { IUserWorkflowMemory } from "../modules/memory/base.memory";
import type { UserWorkflow, WorkflowVariable } from "../types/memory";
import { UserWorkflowService } from "./user-workflow.service";
import type { WorkflowVariableResolver } from "./workflow-variable-resolver.service";

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
});
