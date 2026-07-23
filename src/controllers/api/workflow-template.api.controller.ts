import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import { validateWorkflowDefinition } from "@/services/workflow-variable-resolver.service.js";
import { AinHttpError } from "@/types/agent.js";
import type { WorkflowTemplate } from "@/types/memory";

export class WorkflowTemplateApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public handleGetAllTemplates = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const includeHidden = req.query.includeHidden === "true";
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			const templates = await templateMemory.listTemplates();
			res.json(includeHidden ? templates : templates.filter((t) => !t.hidden));
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
			if (!template.definition) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					"definition is required",
				);
			}
			validateWorkflowDefinition(template.definition);
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
			if (Object.hasOwn(template, "definition")) {
				if (!template.definition) {
					throw new AinHttpError(
						StatusCodes.BAD_REQUEST,
						"definition is required",
					);
				}
				validateWorkflowDefinition(template.definition);
			}
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
