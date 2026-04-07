import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules/index.js";
import type { UserWorkflow } from "@/types/memory.js";
import { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import { resolveTemplateString } from "@/utils/template-variables.js";
import type { QueryService } from "./query.service.js";

/**
 * Service for managing and executing user workflows.
 *
 * Handles CRUD operations, manual execution, and provides data for the scheduler.
 *
 * Variable resolution strategy:
 * - On create: variableValues are resolved into content and title immediately
 * - On execute: only template variables ({{today}}, {{yesterday}}, etc.) are resolved
 */
export class UserWorkflowService {
	private memoryModule: MemoryModule;
	private queryService: QueryService;

	constructor(memoryModule: MemoryModule, queryService: QueryService) {
		this.memoryModule = memoryModule;
		this.queryService = queryService;
	}

	async createWorkflow(workflow: UserWorkflow): Promise<UserWorkflow> {
		const memory = this.memoryModule.getUserWorkflowMemory();

		let { content, title } = workflow;

		// Resolve variableValues into content and title at creation time
		if (workflow.variableValues) {
			for (const [key, value] of Object.entries(workflow.variableValues)) {
				content = content.replaceAll(`{{${key}}}`, value);
				title = title.replaceAll(`{{${key}}}`, value);
			}
		}

		const newWorkflow: UserWorkflow = {
			...workflow,
			workflowId: workflow.workflowId || randomUUID(),
			active: workflow.active ?? true,
			content,
			title,
		};
		return memory.createUserWorkflow(newWorkflow);
	}

	async updateWorkflow(
		workflowId: string,
		updates: Partial<UserWorkflow>,
	): Promise<void> {
		const memory = this.memoryModule.getUserWorkflowMemory();
		await memory.updateUserWorkflow(workflowId, updates);
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

	/**
	 * Executes a user workflow by resolving template variables and running it
	 * through the standard query pipeline.
	 *
	 * User-defined variableValues are already resolved into content/title at creation time.
	 * At execution time, only template variables ({{today}}, {{yesterday}}, etc.) are resolved.
	 *
	 * @param workflowId - The workflow to execute
	 * @returns The thread ID where the result was saved
	 */
	async executeWorkflow(workflowId: string): Promise<{ threadId?: string }> {
		const workflow = await this.getWorkflow(workflowId);
		if (!workflow) {
			throw new Error(`User workflow not found: ${workflowId}`);
		}

		const { timezone } = workflow;

		// Resolve template variables ({{today}}, {{yesterday}}, etc.) at execution time
		const query = resolveTemplateString(workflow.content, timezone);
		const displayQuery = resolveTemplateString(workflow.title, timezone);

		loggers.agent.info(`Executing user workflow: ${workflow.title}`, {
			workflowId,
			resolvedQuery: query,
		});

		// Execute through the standard query pipeline
		const stream = this.queryService.handleQuery(
			{
				type: ThreadType.WORKFLOW,
				userId: workflow.userId,
				workflowId,
			},
			{ query, displayQuery },
		);

		// Consume the stream to completion
		let threadId: string | undefined;
		for await (const event of stream) {
			if (event.event === "thread_id") {
				threadId = event.data.threadId;
			}
		}

		// Update workflow tracking info
		await this.updateWorkflow(workflowId, {
			lastRunAt: Date.now(),
			lastThreadId: threadId,
		});

		loggers.agent.info(`User workflow completed: ${workflow.title}`, {
			workflowId,
			threadId,
		});

		return { threadId };
	}
}
