import type { UserWorkflow } from "@/types/memory.js";
import type { SchedulerService } from "./scheduler.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";

export class UserWorkflowCoordinatorService {
	private userWorkflowService: UserWorkflowService;
	private schedulerService: SchedulerService;

	constructor(
		userWorkflowService: UserWorkflowService,
		schedulerService: SchedulerService,
	) {
		this.userWorkflowService = userWorkflowService;
		this.schedulerService = schedulerService;
	}

	async createWorkflow(workflow: UserWorkflow): Promise<UserWorkflow> {
		const created = await this.userWorkflowService.createWorkflow(workflow);
		if (created.active && created.schedule) {
			await this.schedulerService.scheduleWorkflow(created);
		}
		return created;
	}

	async updateWorkflow(
		workflowId: string,
		updates: Partial<UserWorkflow>,
	): Promise<UserWorkflow | undefined> {
		await this.userWorkflowService.updateWorkflow(workflowId, updates);
		const updatedWorkflow =
			await this.userWorkflowService.getWorkflow(workflowId);
		if (updatedWorkflow) {
			await this.schedulerService.rescheduleWorkflow(updatedWorkflow);
		}
		return updatedWorkflow;
	}

	async deleteWorkflow(workflowId: string, userId: string): Promise<void> {
		await this.userWorkflowService.deleteWorkflow(workflowId, userId);
		await this.schedulerService.unscheduleWorkflow(workflowId);
	}
}
