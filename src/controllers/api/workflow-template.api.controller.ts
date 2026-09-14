import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { WorkflowExecutionService } from "@/services/workflow-execution.service.js";
import { validateWorkflowDefinition } from "@/services/workflow-variable-resolver.service.js";
import { AinHttpError } from "@/types/agent.js";
import type { WorkflowTemplate } from "@/types/memory";
import { streamEventsToSSE } from "@/utils/sse-stream.js";

export class WorkflowTemplateApiController {
	private memoryModule: MemoryModule;
	private workflowExecutionService: WorkflowExecutionService;

	constructor(
		memoryModule: MemoryModule,
		workflowExecutionService: WorkflowExecutionService,
	) {
		this.memoryModule = memoryModule;
		this.workflowExecutionService = workflowExecutionService;
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

	public handleRunTemplateStream = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const userId = res.locals.userId || "";
		const { id } = req.params as { id: string };

		// Existence is checked here, before the SSE layer writes its 200 headers, so
		// a missing template comes back as a real HTTP 404 the caller can branch on —
		// and as a logged line. Once streamEventsToSSE starts, every failure can only
		// reach the client as an SSE error event on an already-successful response.
		try {
			const templateMemory = this.memoryModule.getWorkflowTemplateMemory();
			const template = await templateMemory.getTemplate(id);
			if (!template) {
				throw new AinHttpError(
					StatusCodes.NOT_FOUND,
					`Workflow template not found: ${id}`,
				);
			}
		} catch (error) {
			next(error);
			return;
		}

		await streamEventsToSSE(req, res, {
			logLabel: "Workflow template run stream",
			userId,
			logContext: { templateId: id },
			setup: async (signal) => {
				const { executionVariables } = req.body as {
					executionVariables?: Record<string, string>;
				};
				return this.workflowExecutionService.runTemplateStream(
					id,
					{ userId, executionVariables },
					signal,
				);
			},
		});
	};
}
