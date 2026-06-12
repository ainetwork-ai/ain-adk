import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
import type {
	Document,
	DocumentFilter,
	DocumentSource,
} from "@/types/document.js";

export class DocumentApiController {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
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
			const { workflowId, threadId, source } = req.query as {
				workflowId?: string;
				threadId?: string;
				source?: DocumentSource;
			};
			const filter: DocumentFilter = { workflowId, threadId, source };
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

			const { title, content } = req.body as {
				title?: string;
				content?: string;
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
}
