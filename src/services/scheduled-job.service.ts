import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules/index.js";
import type { ScheduledJob } from "@/types/memory.js";
import { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import {
	resolveTemplateRecord,
	resolveTemplateString,
} from "@/utils/template-variables.js";
import type { QueryService } from "./query.service.js";

/**
 * Service for managing and executing scheduled jobs.
 *
 * Handles CRUD operations and job execution through the standard query pipeline.
 * Template variables in queries and workflow variables are resolved at execution time.
 */
export class ScheduledJobService {
	private memoryModule: MemoryModule;
	private queryService: QueryService;

	constructor(memoryModule: MemoryModule, queryService: QueryService) {
		this.memoryModule = memoryModule;
		this.queryService = queryService;
	}

	async createJob(job: ScheduledJob): Promise<ScheduledJob> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		const newJob: ScheduledJob = {
			...job,
			jobId: job.jobId || randomUUID(),
			active: job.active ?? true,
		};
		return scheduledJobMemory.createScheduledJob(newJob);
	}

	async updateJob(
		jobId: string,
		updates: Partial<ScheduledJob>,
	): Promise<void> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		await scheduledJobMemory.updateScheduledJob(jobId, updates);
	}

	async deleteJob(jobId: string, userId: string): Promise<void> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		await scheduledJobMemory.deleteScheduledJob(jobId, userId);
	}

	async getJob(jobId: string): Promise<ScheduledJob | undefined> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		return scheduledJobMemory.getScheduledJob(jobId);
	}

	async listJobs(userId?: string): Promise<ScheduledJob[]> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		return scheduledJobMemory.listScheduledJobs(userId);
	}

	async listActiveJobs(): Promise<ScheduledJob[]> {
		const scheduledJobMemory = this.memoryModule.getScheduledJobMemory();
		return scheduledJobMemory.listActiveScheduledJobs();
	}

	/**
	 * Executes a scheduled job by resolving template variables and running it
	 * through the standard query pipeline.
	 *
	 * @returns The thread ID where the result was saved
	 */
	async executeJob(jobId: string): Promise<{ threadId: string }> {
		const job = await this.getJob(jobId);
		if (!job) {
			throw new Error(`Scheduled job not found: ${jobId}`);
		}

		const { timezone } = job;

		// Build the query to execute
		let query: string;
		let displayQuery: string | undefined;

		if (job.workflowId) {
			// Workflow-based job: load workflow content and resolve variables
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			const workflow = await workflowMemory?.getWorkflow(job.workflowId);
			if (!workflow) {
				throw new Error(
					`Workflow not found: ${job.workflowId} (referenced by job ${jobId})`,
				);
			}

			query = resolveTemplateString(workflow.content, timezone);
			displayQuery = workflow.title;

			// Resolve workflow variables if present
			if (job.workflowVariables) {
				const resolvedVars = resolveTemplateRecord(
					job.workflowVariables,
					timezone,
				);
				// Replace variable placeholders in query
				for (const [key, value] of Object.entries(resolvedVars)) {
					query = query.replaceAll(`{{${key}}}`, value);
				}
			}
		} else if (job.query) {
			// Direct query job
			query = resolveTemplateString(job.query, timezone);
			displayQuery = job.title;
		} else {
			throw new Error(
				`Scheduled job ${jobId} has neither query nor workflowId`,
			);
		}

		loggers.agent.info(`Executing scheduled job: ${job.title}`, {
			jobId,
			resolvedQuery: query,
		});

		// Execute through the standard query pipeline (non-streaming collection)
		const threadId = randomUUID();
		const stream = this.queryService.handleQuery(
			{
				type: ThreadType.CHAT,
				userId: job.userId,
				threadId,
			},
			{ query, displayQuery },
		);

		// Consume the stream to completion
		let content = "";
		let resultThreadId: string = threadId;
		for await (const event of stream) {
			if (event.event === "thread_id") {
				resultThreadId = event.data.threadId;
			} else if (event.event === "text_chunk" && event.data.delta) {
				content += event.data.delta;
			}
		}

		// Update job tracking info
		await this.updateJob(jobId, {
			lastRunAt: Date.now(),
			lastThreadId: resultThreadId,
		});

		loggers.agent.info(`Scheduled job completed: ${job.title}`, {
			jobId,
			threadId: resultThreadId,
			responseLength: content.length,
		});

		return { threadId: resultThreadId };
	}
}
