import cron, { type ScheduledTask } from "node-cron";
import type { ScheduledJob } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import type { ScheduledJobService } from "./scheduled-job.service.js";

/**
 * Cron-based scheduler that automatically executes scheduled jobs.
 *
 * Loads all active jobs from memory on start, registers cron tasks,
 * and manages the lifecycle of scheduled executions.
 */
export class SchedulerService {
	private scheduledJobService: ScheduledJobService;
	private tasks: Map<string, ScheduledTask> = new Map();

	constructor(scheduledJobService: ScheduledJobService) {
		this.scheduledJobService = scheduledJobService;
	}

	/**
	 * Starts the scheduler by loading all active jobs and registering cron tasks.
	 */
	async start(): Promise<void> {
		const activeJobs = await this.scheduledJobService.listActiveJobs();
		loggers.agent.info(
			`Scheduler starting with ${activeJobs.length} active job(s)`,
		);

		for (const job of activeJobs) {
			this.scheduleJob(job);
		}
	}

	/**
	 * Stops all scheduled tasks.
	 */
	async stop(): Promise<void> {
		loggers.agent.info(
			`Scheduler stopping, clearing ${this.tasks.size} task(s)`,
		);
		for (const [jobId, task] of this.tasks) {
			await task.stop();
			loggers.agent.debug(`Stopped scheduled task: ${jobId}`);
		}
		this.tasks.clear();
	}

	/**
	 * Registers a single job with the cron scheduler.
	 */
	scheduleJob(job: ScheduledJob): void {
		if (this.tasks.has(job.jobId)) {
			this.unscheduleJob(job.jobId);
		}

		if (!cron.validate(job.schedule)) {
			loggers.agent.error(
				`Invalid cron expression for job ${job.jobId}: ${job.schedule}`,
			);
			return;
		}

		const task = cron.schedule(
			job.schedule,
			async (_context) => {
				loggers.agent.info(`Cron triggered job: ${job.title} (${job.jobId})`);
				try {
					const result = await this.scheduledJobService.executeJob(job.jobId);
					loggers.agent.info(
						`Job ${job.jobId} completed, threadId: ${result.threadId}`,
					);
				} catch (error) {
					loggers.agent.error(`Job ${job.jobId} execution failed`, {
						error,
					});
				}
			},
			{
				timezone: job.timezone,
				name: job.jobId,
			},
		);

		this.tasks.set(job.jobId, task);
		loggers.agent.info(
			`Scheduled job: ${job.title} (${job.jobId}) with cron "${job.schedule}"${job.timezone ? ` [${job.timezone}]` : ""}`,
		);
	}

	/**
	 * Removes a job from the cron scheduler.
	 */
	async unscheduleJob(jobId: string): Promise<void> {
		const task = this.tasks.get(jobId);
		if (task) {
			await task.stop();
			this.tasks.delete(jobId);
			loggers.agent.debug(`Unscheduled job: ${jobId}`);
		}
	}

	/**
	 * Reschedules a job (removes old schedule, adds new one).
	 */
	rescheduleJob(job: ScheduledJob): void {
		this.unscheduleJob(job.jobId);
		if (job.active) {
			this.scheduleJob(job);
		}
	}
}
