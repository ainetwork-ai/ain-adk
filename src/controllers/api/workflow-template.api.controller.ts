import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { WorkflowTemplate } from "@/types/memory";

export class WorkflowTemplateApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleGetAllTemplates = async (
		_req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			const templates = await templateMemory.listTemplates();
			res.json(templates);
		} catch (error) {
			next(error);
		}
	};

	public handleGetTemplate = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			const template = await templateMemory.getTemplate(id);
			if (!template) {
				res.status(StatusCodes.NOT_FOUND).send();
				return;
			}
			res.json(template);
		} catch (error) {
			next(error);
		}
	};

	public handleCreateTemplate = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const template = req.body as WorkflowTemplate;
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			const created = await templateMemory.createTemplate(template);
			res.status(StatusCodes.CREATED).json(created);
		} catch (error) {
			next(error);
		}
	};

	public handleUpdateTemplate = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const template = req.body as Partial<WorkflowTemplate>;
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			await templateMemory.updateTemplate(id, template);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteTemplate = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id } = req.params as { id: string };
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			await templateMemory.deleteTemplate(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};
}
