import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { QueryService } from "@/services/query.service.js";
import type { UserWorkflowService } from "@/services/user-workflow.service.js";
import type { UserWorkflowCoordinatorService } from "@/services/user-workflow-coordinator.service.js";
import type { WorkflowExecutionService } from "@/services/workflow-execution.service.js";
import { AinHttpError } from "@/types/agent.js";
import { MessageRole, type UserWorkflow } from "@/types/memory.js";
import { streamEventsToSSE } from "@/utils/sse-stream.js";

export class UserWorkflowApiController {
	private userWorkflowService: UserWorkflowService;
	private userWorkflowCoordinatorService: UserWorkflowCoordinatorService;
	private workflowExecutionService: WorkflowExecutionService;
	private queryService: QueryService;

	constructor(
		userWorkflowService: UserWorkflowService,
		userWorkflowCoordinatorService: UserWorkflowCoordinatorService,
		workflowExecutionService: WorkflowExecutionService,
		queryService: QueryService,
	) {
		this.userWorkflowService = userWorkflowService;
		this.userWorkflowCoordinatorService = userWorkflowCoordinatorService;
		this.workflowExecutionService = workflowExecutionService;
		this.queryService = queryService;
	}

	private async getAuthorizedWorkflow(
		userId: string,
		workflowId: string,
	): Promise<UserWorkflow> {
		const workflow = await this.userWorkflowService.getWorkflow(workflowId);
		if (!workflow || workflow.userId !== userId) {
			throw new AinHttpError(StatusCodes.NOT_FOUND, "Workflow not found");
		}
		return workflow;
	}

	public handleGetAllWorkflows = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const workflows = await this.userWorkflowService.listWorkflows(userId);
			res.json(workflows);
		} catch (error) {
			next(error);
		}
	};

	public handleGetWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			const workflow = await this.getAuthorizedWorkflow(userId, id);
			res.json(workflow);
		} catch (error) {
			next(error);
		}
	};

	public handleCreateWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const workflowData = req.body as UserWorkflow;
			if (!workflowData.definition) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					"definition is required",
				);
			}
			const created = await this.userWorkflowCoordinatorService.createWorkflow({
				...workflowData,
				userId,
			});

			res.status(StatusCodes.CREATED).json(created);
		} catch (error) {
			next(error);
		}
	};

	public handleUpdateWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedWorkflow(userId, id);
			const updates = req.body as Partial<UserWorkflow>;
			const updated = await this.userWorkflowCoordinatorService.updateWorkflow(
				id,
				{
					...updates,
					userId,
				},
			);

			// 갱신된 워크플로우(재스케줄 후 nextRunAt 포함)를 돌려줘야 클라이언트가
			// 재조회 없이 예약 상태를 갱신할 수 있다. (기존: 빈 200 응답)
			res.status(StatusCodes.OK).json(updated ?? null);
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedWorkflow(userId, id);

			await this.userWorkflowCoordinatorService.deleteWorkflow(id, userId);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleExecuteWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedWorkflow(userId, id);

			const { executionVariables } = req.body as {
				executionVariables?: Record<string, string>;
			};
			const result = await this.workflowExecutionService.executeWorkflow(
				id,
				executionVariables,
			);

			res.status(StatusCodes.OK).json(result);
		} catch (error) {
			next(error);
		}
	};

	public handleExecuteWorkflowStream = async (req: Request, res: Response) => {
		const userId = res.locals.userId || "";
		const { id } = req.params as { id: string };

		await streamEventsToSSE(req, res, {
			logLabel: "Workflow stream",
			userId,
			logContext: { workflowId: id },
			setup: async (signal) => {
				await this.getAuthorizedWorkflow(userId, id);
				const { executionVariables } = req.body as {
					executionVariables?: Record<string, string>;
				};
				return this.workflowExecutionService.executeWorkflowStream(
					id,
					executionVariables,
					signal,
				);
			},
			onThinkingProcess: async (currentThreadId, data) => {
				const thinkData =
					await this.queryService.filterThinkingDataForStorage(data);
				await this.queryService.addTextMessage(
					userId,
					currentThreadId,
					MessageRole.MODEL,
					thinkData.title,
					{
						isThinking: true,
						thinkData,
					},
				);
			},
		});
	};
}
