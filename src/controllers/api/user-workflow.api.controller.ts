import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { SchedulerService } from "@/services/scheduler.service.js";
import type { UserWorkflowService } from "@/services/user-workflow.service.js";
import { AinHttpError } from "@/types/agent.js";
import type { UserWorkflow } from "@/types/memory.js";

export class UserWorkflowApiController {
	private userWorkflowService: UserWorkflowService;
	private schedulerService: SchedulerService;

	constructor(
		userWorkflowService: UserWorkflowService,
		schedulerService: SchedulerService,
	) {
		this.userWorkflowService = userWorkflowService;
		this.schedulerService = schedulerService;
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
			const created = await this.userWorkflowService.createWorkflow({
				...workflowData,
				userId,
			});

			// Register with the scheduler if active and has a schedule
			if (created.active && created.schedule) {
				await this.schedulerService.scheduleWorkflow(created);
			}

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
			await this.userWorkflowService.updateWorkflow(id, {
				...updates,
				userId,
			});

			// Reschedule with updated data
			const updatedWorkflow = await this.getAuthorizedWorkflow(userId, id);
			await this.schedulerService.rescheduleWorkflow(updatedWorkflow);

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

			await this.userWorkflowService.deleteWorkflow(id, userId);
			await this.schedulerService.unscheduleWorkflow(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};
}
