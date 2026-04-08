import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { UserWorkflowService } from "@/services/user-workflow.service.js";
import type { UserWorkflowCoordinatorService } from "@/services/user-workflow-coordinator.service.js";
import { AinHttpError } from "@/types/agent.js";
import type { UserWorkflow } from "@/types/memory.js";

export class UserWorkflowApiController {
	private userWorkflowService: UserWorkflowService;
	private userWorkflowCoordinatorService: UserWorkflowCoordinatorService;

	constructor(
		userWorkflowService: UserWorkflowService,
		userWorkflowCoordinatorService: UserWorkflowCoordinatorService,
	) {
		this.userWorkflowService = userWorkflowService;
		this.userWorkflowCoordinatorService = userWorkflowCoordinatorService;
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
			await this.userWorkflowCoordinatorService.updateWorkflow(id, {
				...updates,
				userId,
			});

			res.status(StatusCodes.OK).send();
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
}
