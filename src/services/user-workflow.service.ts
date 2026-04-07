import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules/index.js";
import type { UserWorkflow } from "@/types/memory.js";
import { ThreadType } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import {
	resolveTemplateRecord,
	resolveTemplateString,
} from "@/utils/template-variables.js";
import type { QueryService } from "./query.service.js";

/**
 * Service for managing and executing user workflows.
 *
 * Handles CRUD operations, manual execution, and provides data for the scheduler.
 *
 * Variable resolution strategy:
 * - On create: resolveAt="creation" variables are resolved into content/title immediately
 * - On execute: resolveAt="execution" variables are resolved from user input,
 *   then template variables ({{today}}, {{yesterday}}, etc.) are resolved
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

		// Resolve only "creation" variables into content and title
		if (workflow.variableValues && workflow.variables) {
			for (const [key, value] of Object.entries(workflow.variableValues)) {
				const variable = workflow.variables[key];
				const resolveAt = variable?.resolveAt ?? "creation";
				if (resolveAt === "creation") {
					content = content.replaceAll(`{{${key}}}`, value);
					title = title.replaceAll(`{{${key}}}`, value);
				}
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
	 * Executes a user workflow by resolving variables and running it
	 * through the standard query pipeline.
	 *
	 * Resolution order:
	 * 1. resolveAt="execution" variables are replaced from executionVariables param
	 * 2. Template variables ({{today}}, {{yesterday}}, etc.) are resolved
	 *
	 * @param workflowId - The workflow to execute
	 * @param executionVariables - Values for resolveAt="execution" variables (e.g., date range from UI)
	 * @returns The thread ID where the result was saved
	 */
	async executeWorkflow(
		workflowId: string,
		executionVariables?: Record<string, string>,
	): Promise<{ threadId?: string }> {
		const workflow = await this.getWorkflow(workflowId);
		if (!workflow) {
			throw new Error(`User workflow not found: ${workflowId}`);
		}

		const { timezone } = workflow;

		let query = workflow.content;
		let displayQuery = workflow.title;

		// 1. Resolve "execution" variables from provided values
		if (executionVariables) {
			const resolvedVars = resolveTemplateRecord(executionVariables, timezone);
			for (const [key, value] of Object.entries(resolvedVars)) {
				query = query.replaceAll(`{{${key}}}`, value);
				displayQuery = displayQuery.replaceAll(`{{${key}}}`, value);
			}
		}

		// 2. Resolve remaining template variables ({{today}}, {{yesterday}}, etc.)
		query = resolveTemplateString(query, timezone);
		displayQuery = resolveTemplateString(displayQuery, timezone);

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
