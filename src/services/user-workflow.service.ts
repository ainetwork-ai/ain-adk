import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules/index.js";
import type { UserWorkflow } from "@/types/memory.js";
import type { WorkflowVariableResolver } from "./workflow-variable-resolver.service.js";

/**
 * Service for persisting user workflows.
 *
 * Keeps storage-focused operations in one place while delegating variable resolution
 * and execution orchestration to dedicated collaborators.
 */
export class UserWorkflowService {
	private memoryModule: MemoryModule;
	private workflowVariableResolver: WorkflowVariableResolver;

	constructor(
		memoryModule: MemoryModule,
		workflowVariableResolver: WorkflowVariableResolver,
	) {
		this.memoryModule = memoryModule;
		this.workflowVariableResolver = workflowVariableResolver;
	}

	async createWorkflow(workflow: UserWorkflow): Promise<UserWorkflow> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		const normalizedWorkflow: UserWorkflow = {
			...workflow,
			content: workflow.content || workflow.title,
			variables: this.workflowVariableResolver.normalizeVariables(
				workflow.variables,
			),
		};
		const { content, title, definition } =
			this.workflowVariableResolver.resolveForCreation(normalizedWorkflow);

		const newWorkflow: UserWorkflow = {
			...normalizedWorkflow,
			workflowId: workflow.workflowId || randomUUID(),
			active: workflow.active ?? true,
			content,
			title,
			definition,
		};
		return memory.createUserWorkflow(newWorkflow);
	}

	async updateWorkflow(
		workflowId: string,
		updates: Partial<UserWorkflow>,
	): Promise<void> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		await memory.updateUserWorkflow(workflowId, {
			...updates,
			variables: this.workflowVariableResolver.normalizeVariables(
				updates.variables,
			),
			definition: this.workflowVariableResolver.normalizeDefinition(
				updates.definition,
			),
		});
	}

	async deleteWorkflow(workflowId: string, userId: string): Promise<void> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		await memory.deleteUserWorkflow(workflowId, userId);
	}

	async getWorkflow(workflowId: string): Promise<UserWorkflow | undefined> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		return memory.getUserWorkflow(workflowId);
	}

	async listWorkflows(userId?: string): Promise<UserWorkflow[]> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		return memory.listUserWorkflows(userId);
	}

	async listActiveScheduledWorkflows(): Promise<UserWorkflow[]> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		return memory.listActiveScheduledWorkflows();
	}
}
