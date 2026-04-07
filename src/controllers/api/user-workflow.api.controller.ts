import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { SchedulerService } from "@/services/scheduler.service.js";
import type { UserWorkflowService } from "@/services/user-workflow.service.js";
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
			const { id } = req.params as { id: string };
			const workflow = await this.userWorkflowService.getWorkflow(id);
			if (!workflow) {
				res.status(StatusCodes.NOT_FOUND).send();
				return;
			}
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
				this.schedulerService.scheduleWorkflow(created);
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
			const updates = req.body as Partial<UserWorkflow>;
			await this.userWorkflowService.updateWorkflow(id, {
				...updates,
				userId,
			});

			// Reschedule with updated data
			const updatedWorkflow = await this.userWorkflowService.getWorkflow(id);
			if (updatedWorkflow) {
				this.schedulerService.rescheduleWorkflow(updatedWorkflow);
			}

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

			// Remove from scheduler first
			this.schedulerService.unscheduleWorkflow(id);

			await this.userWorkflowService.deleteWorkflow(id, userId);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	/**
	 * Manually trigger a workflow execution.
	 * Returns as soon as the threadId is assigned — the execution continues in the background.
	 * Accepts executionVariables for resolveAt="execution" variables (e.g., date range).
	 * Template variables ({{today}}, etc.) are also resolved at execution time.
	 */
	public handleRunWorkflow = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const { executionVariables } = req.body as {
				executionVariables?: Record<string, string>;
			};
			const result = await this.userWorkflowService.executeWorkflow(
				id,
				executionVariables,
			);
			res.status(StatusCodes.OK).json(result);
		} catch (error) {
			next(error);
		}
	};
}
