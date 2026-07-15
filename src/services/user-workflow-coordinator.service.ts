import { StatusCodes } from "http-status-codes";
import cron from "node-cron";
import { AinHttpError } from "@/types/agent.js";
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

	private assertValidSchedule(schedule: string | undefined): void {
		if (schedule && !cron.validate(schedule)) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Invalid cron expression: ${schedule}`,
			);
		}
	}

	async createWorkflow(workflow: UserWorkflow): Promise<UserWorkflow> {
		this.assertValidSchedule(workflow.schedule);
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
		this.assertValidSchedule(updates.schedule);
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
