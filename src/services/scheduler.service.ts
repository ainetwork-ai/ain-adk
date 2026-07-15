import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import type { MemoryModule } from "@/modules/memory/memory.module.js";
import type { UserWorkflow } from "@/types/memory.js";
import type { ScheduleTrigger } from "@/types/schedule.js";
import { loggers } from "@/utils/logger.js";
import type { JobRunnerService } from "./job-runner.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";
import type { WorkflowExecutionService } from "./workflow-execution.service.js";

/**
 * Cron-based scheduler for user workflows plus one-shot document auto
 * refreshes. Triggering (node-cron / minute tick) is separated from
 * execution: every run goes through the JobRunner, which owns concurrency,
 * retries and the rate-limit cooldown. This service owns run history and
 * schedule state (nextRunAt, autoRefresh bookkeeping).
 */
export class SchedulerService {
	private userWorkflowService: UserWorkflowService;
	private workflowExecutionService: WorkflowExecutionService;
	private jobRunner: JobRunnerService;
	private memoryModule: MemoryModule;
	private tasks: Map<string, ScheduledTask> = new Map();

	constructor(
		userWorkflowService: UserWorkflowService,
		workflowExecutionService: WorkflowExecutionService,
		jobRunner: JobRunnerService,
		memoryModule: MemoryModule,
	) {
		this.userWorkflowService = userWorkflowService;
		this.workflowExecutionService = workflowExecutionService;
		this.jobRunner = jobRunner;
		this.memoryModule = memoryModule;
	}

	async start(): Promise<void> {
		const scheduleRunMemory = this.memoryModule.getScheduleRunMemory();
		if (scheduleRunMemory) {
			const interrupted = await scheduleRunMemory.failInterruptedRuns();
			if (interrupted > 0) {
				loggers.agent.warn(
					`Marked ${interrupted} interrupted schedule run(s) as failed`,
				);
			}
		}

		const activeWorkflows =
			await this.userWorkflowService.listActiveScheduledWorkflows();
		loggers.agent.info(
			`Scheduler starting with ${activeWorkflows.length} active workflow(s)`,
		);
		for (const workflow of activeWorkflows) {
			// Catch-up BEFORE scheduleWorkflow refreshes nextRunAt.
			const overdue =
				workflow.nextRunAt !== undefined && workflow.nextRunAt <= Date.now();
			await this.scheduleWorkflow(workflow);
			if (overdue) {
				void this.runWorkflowJob(
					workflow.workflowId,
					"catchup",
					workflow.nextRunAt ?? Date.now(),
				);
			}
		}
	}

	async stop(): Promise<void> {
		loggers.agent.info(
			`Scheduler stopping, clearing ${this.tasks.size} task(s)`,
		);
		for (const [workflowId, task] of this.tasks) {
			await task.stop();
			loggers.agent.debug(`Stopped scheduled task: ${workflowId}`);
		}
		this.tasks.clear();
		await this.jobRunner.drain();
	}

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
				await this.runWorkflowJob(workflow.workflowId, "cron", Date.now());
			},
			{
				timezone: workflow.timezone,
				name: workflow.workflowId,
			},
		);
		this.tasks.set(workflow.workflowId, task);

		const nextRun = task.getNextRun();
		await this.userWorkflowService.updateWorkflow(workflow.workflowId, {
			userId: workflow.userId,
			nextRunAt: nextRun ? nextRun.getTime() : undefined,
		});
		loggers.agent.info(
			`Scheduled workflow: ${workflow.title} (${workflow.workflowId}) with cron "${workflow.schedule}"${workflow.timezone ? ` [${workflow.timezone}]` : ""}`,
		);
	}

	async unscheduleWorkflow(workflowId: string): Promise<void> {
		const task = this.tasks.get(workflowId);
		if (task) {
			await task.stop();
			this.tasks.delete(workflowId);
			loggers.agent.debug(`Unscheduled workflow: ${workflowId}`);
		}
	}

	async rescheduleWorkflow(workflow: UserWorkflow): Promise<void> {
		await this.unscheduleWorkflow(workflow.workflowId);
		if (workflow.active && workflow.schedule) {
			await this.scheduleWorkflow(workflow);
		}
	}

	/**
	 * Executes one scheduled workflow run through the JobRunner and records
	 * it in schedule_runs. Public for tests and manual triggering.
	 *
	 * Never rejects: execution errors are absorbed by the JobRunner, and
	 * bookkeeping (memory) errors are caught and logged here so that
	 * fire-and-forget callers (boot catch-up) cannot crash the process
	 * with an unhandled rejection.
	 */
	async runWorkflowJob(
		workflowId: string,
		trigger: ScheduleTrigger,
		scheduledFor: number,
	): Promise<void> {
		try {
			const scheduleRunMemory = this.memoryModule.getScheduleRunMemory();
			const runId = randomUUID();
			const startedAt = Date.now();
			await scheduleRunMemory?.createScheduleRun({
				runId,
				jobType: "WORKFLOW",
				jobKey: workflowId,
				trigger,
				scheduledFor,
				startedAt,
				status: "running",
				attempts: 0,
			});

			const workflow = await this.userWorkflowService.getWorkflow(workflowId);
			if (!workflow) {
				// Deleted since scheduling: stop repeating a doomed job.
				await this.unscheduleWorkflow(workflowId);
				await scheduleRunMemory?.updateScheduleRun(runId, {
					status: "failed",
					finishedAt: Date.now(),
					attempts: 1,
					error: "Workflow not found; unscheduled",
				});
				return;
			}

			const outcome = await this.jobRunner.submit({
				jobKey: workflowId,
				execute: async () => {
					await this.workflowExecutionService.executeWorkflow(workflowId);
				},
			});

			await scheduleRunMemory?.updateScheduleRun(runId, {
				status: outcome.status,
				finishedAt: Date.now(),
				attempts: outcome.attempts,
				error: outcome.status === "failed" ? outcome.error : undefined,
			});

			const nextRun = this.tasks.get(workflowId)?.getNextRun();
			await this.userWorkflowService.updateWorkflow(workflowId, {
				userId: workflow.userId,
				lastRunAt: startedAt,
				nextRunAt: nextRun ? nextRun.getTime() : undefined,
			});
		} catch (error) {
			loggers.agent.error("Scheduled run bookkeeping failed", {
				workflowId,
				error,
			});
		}
	}
}
