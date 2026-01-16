import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { Workflow } from "@/types/memory";

export class WorkflowApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleGetAllWorkflows = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { userId } = req.query as { userId?: string };
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			const workflows = await workflowMemory?.listWorkflows(userId);
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
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			const workflow = await workflowMemory?.getWorkflow(id);
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
			const workflow = req.body as Workflow;
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			const created = await workflowMemory?.createWorkflow(workflow);
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
			const { id } = req.params as { id: string };
			const workflow = req.body as Partial<Workflow>;
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			await workflowMemory?.updateWorkflow(id, workflow);
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
			const { id } = req.params as { id: string };
			const workflowMemory = this.memoryModule.getWorkflowMemory();
			await workflowMemory?.deleteWorkflow(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};
}
