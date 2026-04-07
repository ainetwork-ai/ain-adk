import cron, { type ScheduledTask } from "node-cron";
import type { UserWorkflow } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import type { UserWorkflowService } from "./user-workflow.service.js";

/**
 * Cron-based scheduler that automatically executes user workflows.
 *
 * Loads all active scheduled workflows from memory on start, registers cron tasks,
 * and manages the lifecycle of scheduled executions.
 */
export class SchedulerService {
	private userWorkflowService: UserWorkflowService;
	private tasks: Map<string, ScheduledTask> = new Map();

	constructor(userWorkflowService: UserWorkflowService) {
		this.userWorkflowService = userWorkflowService;
	}

	/**
	 * Starts the scheduler by loading all active scheduled workflows and registering cron tasks.
	 */
	async start(): Promise<void> {
		const activeWorkflows =
			await this.userWorkflowService.listActiveScheduledWorkflows();
		loggers.agent.info(
			`Scheduler starting with ${activeWorkflows.length} active workflow(s)`,
		);

		for (const workflow of activeWorkflows) {
			await this.scheduleWorkflow(workflow);
		}
	}

	/**
	 * Stops all scheduled tasks.
	 */
	async stop(): Promise<void> {
		loggers.agent.info(
			`Scheduler stopping, clearing ${this.tasks.size} task(s)`,
		);
		for (const [workflowId, task] of this.tasks) {
			await task.stop();
			loggers.agent.debug(`Stopped scheduled task: ${workflowId}`);
		}
		this.tasks.clear();
	}

	/**
	 * Registers a single workflow with the cron scheduler.
	 */
	async scheduleWorkflow(workflow: UserWorkflow): Promise<void> {
		if (!workflow.schedule) {
			return;
		}

		if (this.tasks.has(workflow.workflowId)) {
			await this.unscheduleWorkflow(workflow.workflowId);
		}

		if (!cron.validate(workflow.schedule)) {
			loggers.agent.error(
				`Invalid cron expression for workflow ${workflow.workflowId}: ${workflow.schedule}`,
			);
			return;
		}

		const task = cron.schedule(
			workflow.schedule,
			async (_context) => {
				loggers.agent.info(
					`Cron triggered workflow: ${workflow.title} (${workflow.workflowId})`,
				);
				try {
					const result = await this.userWorkflowService.executeWorkflow(
						workflow.workflowId,
					);
					loggers.agent.info(
						`Workflow ${workflow.workflowId} completed, threadId: ${result.threadId}`,
					);
				} catch (error) {
					loggers.agent.error(
						`Workflow ${workflow.workflowId} execution failed`,
						{ error },
					);
				}
			},
			{
				timezone: workflow.timezone,
				name: workflow.workflowId,
			},
		);

		this.tasks.set(workflow.workflowId, task);
		loggers.agent.info(
			`Scheduled workflow: ${workflow.title} (${workflow.workflowId}) with cron "${workflow.schedule}"${workflow.timezone ? ` [${workflow.timezone}]` : ""}`,
		);
	}

	/**
	 * Removes a workflow from the cron scheduler.
	 */
	async unscheduleWorkflow(workflowId: string): Promise<void> {
		const task = this.tasks.get(workflowId);
		if (task) {
			await task.stop();
			this.tasks.delete(workflowId);
			loggers.agent.debug(`Unscheduled workflow: ${workflowId}`);
		}
	}

	/**
	 * Reschedules a workflow (removes old schedule, adds new one if active and has schedule).
	 */
	async rescheduleWorkflow(workflow: UserWorkflow): Promise<void> {
		await this.unscheduleWorkflow(workflow.workflowId);
		if (workflow.active && workflow.schedule) {
			await this.scheduleWorkflow(workflow);
		}
	}
}
