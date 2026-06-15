import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { WorkflowExecutionService } from "@/services/workflow-execution.service.js";
import { AinHttpError } from "@/types/agent.js";
import {
	type Document,
	type DocumentFilter,
	DocumentFormat,
	type DocumentSlot,
	DocumentSource,
} from "@/types/document.js";
import { streamEventsToSSE } from "@/utils/sse-stream.js";

export class DocumentApiController {
	private memoryModule: MemoryModule;
	private workflowExecutionService: WorkflowExecutionService;

	constructor(
		memoryModule: MemoryModule,
		workflowExecutionService: WorkflowExecutionService,
	) {
		this.memoryModule = memoryModule;
		this.workflowExecutionService = workflowExecutionService;
	}

	private async getAuthorizedDocument(
		userId: string,
		documentId: string,
	): Promise<Document> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		const document = await documentMemory?.getDocument(documentId);
		if (!document || document.userId !== userId) {
			throw new AinHttpError(StatusCodes.NOT_FOUND, "Document not found");
		}
		return document;
	}

	public handleGetAllDocuments = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const documentMemory = this.memoryModule.getDocumentMemory();
			const { workflowId, threadId, source, groupId } = req.query as {
				workflowId?: string;
				threadId?: string;
				source?: DocumentSource;
				groupId?: string;
			};
			const filter: DocumentFilter = { workflowId, threadId, source, groupId };
			const documents = await documentMemory?.listDocuments(userId, filter);
			res.json(documents ?? []);
		} catch (error) {
			next(error);
		}
	};

	public handleGetDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			const document = await this.getAuthorizedDocument(userId, id);
			res.json(document);
		} catch (error) {
			next(error);
		}
	};

	public handleUpdateDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			const existing = await this.getAuthorizedDocument(userId, id);

			const { title, content, slots } = req.body as {
				title?: string;
				content?: string;
				slots?: DocumentSlot[];
			};

			const updates: Partial<Document> = {
				version: existing.version + 1,
				editedManually: true,
				updatedAt: new Date().toISOString(),
			};
			if (title !== undefined) {
				updates.title = title;
			}
			if (content !== undefined) {
				updates.content = content;
			}
			if (slots !== undefined) {
				updates.slots = slots;
			}

			await this.memoryModule.getDocumentMemory()?.updateDocument(id, updates);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleDeleteDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedDocument(userId, id);

			await this.memoryModule.getDocumentMemory()?.deleteDocument(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	public handleCreateDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const documentMemory = this.memoryModule.getDocumentMemory();
			const { title, content, slots, groupId, format } = req.body as {
				title?: string;
				content?: string;
				slots?: DocumentSlot[];
				groupId?: string;
				format?: DocumentFormat;
			};

			const now = new Date().toISOString();
			const document: Document = {
				documentId: randomUUID(),
				userId,
				title: title ?? "Untitled",
				format: format ?? DocumentFormat.MARKDOWN,
				content: content ?? "",
				slots,
				groupId,
				source: DocumentSource.MANUAL,
				version: 1,
				createdAt: now,
				updatedAt: now,
			};

			const created = await documentMemory?.createDocument(document);
			res.status(StatusCodes.CREATED).json(created ?? document);
		} catch (error) {
			next(error);
		}
	};

	public handleFillSlot = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id, slotId } = req.params as { id: string; slotId: string };
			await this.getAuthorizedDocument(userId, id);

			const { workflowId, executionVariables } = req.body as {
				workflowId?: string;
				executionVariables?: Record<string, string>;
			};
			const result = await this.workflowExecutionService.fillDocumentSlot(
				id,
				slotId,
				{ workflowId, executionVariables },
			);
			res.status(StatusCodes.OK).json(result);
		} catch (error) {
			next(error);
		}
	};

	public handleFillSlotStream = async (req: Request, res: Response) => {
		const userId = res.locals.userId || "";
		const { id, slotId } = req.params as { id: string; slotId: string };

		await streamEventsToSSE(req, res, {
			logLabel: "Document slot fill stream",
			userId,
			logContext: { documentId: id, slotId },
			setup: async (signal) => {
				await this.getAuthorizedDocument(userId, id);
				const { workflowId, executionVariables } = req.body as {
					workflowId?: string;
					executionVariables?: Record<string, string>;
				};
				return this.workflowExecutionService.fillDocumentSlotStream(
					id,
					slotId,
					{ workflowId, executionVariables },
					signal,
				);
			},
		});
	};
}
