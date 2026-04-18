import { ThreadType } from "@/types/memory.js";
import type { WorkflowExecutionInput } from "@/types/message-input.js";
import { loggers } from "@/utils/logger.js";
import type { QueryService } from "./query.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";
import type { WorkflowVariableResolver } from "./workflow-variable-resolver.service.js";

export class WorkflowExecutionService {
	private userWorkflowService: UserWorkflowService;
	private queryService: QueryService;
	private workflowVariableResolver: WorkflowVariableResolver;

	constructor(
		userWorkflowService: UserWorkflowService,
		queryService: QueryService,
		workflowVariableResolver: WorkflowVariableResolver,
	) {
		this.userWorkflowService = userWorkflowService;
		this.queryService = queryService;
		this.workflowVariableResolver = workflowVariableResolver;
	}

	private createQueryData(
		executionInput: WorkflowExecutionInput,
	): WorkflowExecutionInput {
		return {
			query: executionInput.query,
			displayQuery: executionInput.displayQuery,
			input: executionInput.input,
		};
	}

	async executeWorkflow(
		workflowId: string,
		executionVariables?: Record<string, string>,
	): Promise<{ threadId?: string }> {
		const workflow = await this.userWorkflowService.getWorkflow(workflowId);
		if (!workflow) {
			throw new Error(`User workflow not found: ${workflowId}`);
		}

		const executionInput = this.workflowVariableResolver.resolveForExecution(
			workflow,
			executionVariables,
		);

		loggers.agent.info(`Executing user workflow: ${workflow.title}`, {
			workflowId,
			resolvedQuery: executionInput.query,
		});

		const stream = this.queryService.handleQuery(
			{
				type: ThreadType.WORKFLOW,
				userId: workflow.userId,
				workflowId,
				title: workflow.title,
			},
			this.createQueryData(executionInput),
		);

		let threadId: string | undefined;
		for await (const event of stream) {
			if (event.event === "thread_id") {
				threadId = event.data.threadId;
			}
		}

		await this.userWorkflowService.updateWorkflow(workflowId, {
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
