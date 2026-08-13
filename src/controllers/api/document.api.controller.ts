import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { MemoryModule } from "@/modules/index.js";
import type { DocumentAdviceService } from "@/services/document-advice.service.js";
import type { SchedulerService } from "@/services/scheduler.service.js";
import type { WorkflowExecutionService } from "@/services/workflow-execution.service.js";
import { AinHttpError } from "@/types/agent.js";
import {
	type Document,
	type DocumentAutoRefresh,
	type DocumentFilter,
	type DocumentFilterSet,
	DocumentFormat,
	type DocumentListOptions,
	type DocumentSlot,
	DocumentSource,
} from "@/types/document.js";
import type { PaginatedResult } from "@/types/list.js";
import { parseAutoRefreshPayload } from "@/utils/auto-refresh-payload.js";
import { parseListOptions } from "@/utils/parse-list-options.js";
import { streamEventsToSSE } from "@/utils/sse-stream.js";

export class DocumentApiController {
	private memoryModule: MemoryModule;
	private workflowExecutionService: WorkflowExecutionService;
	private documentAdviceService: DocumentAdviceService;
	private schedulerService: SchedulerService;

	constructor(
		memoryModule: MemoryModule,
		workflowExecutionService: WorkflowExecutionService,
		documentAdviceService: DocumentAdviceService,
		schedulerService: SchedulerService,
	) {
		this.memoryModule = memoryModule;
		this.workflowExecutionService = workflowExecutionService;
		this.documentAdviceService = documentAdviceService;
		this.schedulerService = schedulerService;
	}

	private async getAuthorizedDocument(
		userId: string,
		documentId: string,
		authzChecked = false,
	): Promise<Document> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		const document = await documentMemory?.getDocument(documentId);
		if (!document) {
			throw new AinHttpError(StatusCodes.NOT_FOUND, "Document not found");
		}
		// When the authorize middleware already granted access, skip the
		// per-owner check (enables cross-user logbook read/write by role).
		// Otherwise this is an authorization failure, not a missing record: the
		// document exists (reads are open) but the caller may not write it.
		if (!authzChecked && document.userId !== userId) {
			throw new AinHttpError(
				StatusCodes.FORBIDDEN,
				"You do not have permission for this document",
			);
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
			const { workflowId, threadId, source, labels, dateFrom, dateTo, view } =
				req.query as {
					workflowId?: string;
					threadId?: string;
					source?: DocumentSource;
					labels?: Record<string, string>;
					dateFrom?: string;
					dateTo?: string;
					view?: string;
				};
			const baseFilter: DocumentFilter = {
				workflowId,
				threadId,
				source,
				labels,
				dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
				dateTo: typeof dateTo === "string" ? dateTo : undefined,
			};
			const listOptions = parseListOptions(
				req.query as Record<string, unknown>,
			);
			const options: DocumentListOptions = {
				...(listOptions ?? {}),
				summary: view === "summary",
			};

			// RBAC scopes as an OR-set of (userId, filter) pairs. Single query
			// (when the provider supports it) keeps skip/limit/count correct.
			const authzFilters = res.locals.authzFilters as
				| DocumentFilter[]
				| undefined;
			let filterSets: DocumentFilterSet[];
			if (res.locals.authzListAll) {
				filterSets = [{ filter: baseFilter }];
			} else if (authzFilters?.length) {
				filterSets = [
					{ userId, filter: baseFilter },
					...authzFilters.map((f) => ({
						filter: {
							...baseFilter,
							labels: { ...(labels ?? {}), ...(f.labels ?? {}) },
						},
					})),
				];
			} else {
				filterSets = [{ userId, filter: baseFilter }];
			}

			const { items, total } = await this.listDocumentsBySets(
				documentMemory,
				filterSets,
				options,
			);

			if (listOptions) {
				const body: PaginatedResult<Document> = {
					items,
					total,
					limit: listOptions.limit,
					offset: listOptions.offset,
				};
				res.json(body);
			} else {
				res.json(items);
			}
		} catch (error) {
			next(error);
		}
	};

	/**
	 * Union of the filter sets via the provider's single-query method when
	 * available; otherwise per-set fetch merged in memory. The fallback also
	 * emulates date range, summary and offset/limit so old providers stay
	 * correct (just slower).
	 */
	private async listDocumentsBySets(
		memory: ReturnType<MemoryModule["getDocumentMemory"]>,
		filterSets: DocumentFilterSet[],
		options: DocumentListOptions,
	): Promise<{ items: Document[]; total: number }> {
		if (!memory) return { items: [], total: 0 };

		if (memory.listDocumentsAny) {
			const items = await memory.listDocumentsAny(filterSets, options);
			const total =
				options.limit !== undefined && memory.countDocumentsAny
					? await memory.countDocumentsAny(filterSets)
					: items.length;
			return { items, total };
		}

		const sets = await Promise.all(
			filterSets.map((s) => memory.listDocuments(s.userId, s.filter)),
		);
		const byId = new Map<string, Document>();
		for (const d of sets.flat()) byId.set(d.documentId, d);

		const { dateFrom, dateTo } = filterSets[0]?.filter ?? {};
		let items = [...byId.values()];
		if (dateFrom || dateTo) {
			items = items.filter((d) => {
				const date = d.labels?.date;
				if (!date) return false;
				if (dateFrom && date < dateFrom) return false;
				if (dateTo && date > dateTo) return false;
				return true;
			});
		}
		items.sort(
			(a, b) =>
				String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) ||
				b.documentId.localeCompare(a.documentId),
		);
		const total = items.length;
		if (options.limit !== undefined || options.offset) {
			const start = options.offset ?? 0;
			items = items.slice(
				start,
				options.limit !== undefined ? start + options.limit : undefined,
			);
		}
		if (options.summary) {
			items = items.map(({ slots: _slots, ...rest }) => rest as Document);
		}
		return { items, total };
	}

	public handleGetDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			const document = await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);
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
			const existing = await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			const { title, content, slots, labels } = req.body as {
				title?: string;
				content?: string;
				slots?: DocumentSlot[];
				labels?: Record<string, string>;
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
			if (labels !== undefined) {
				updates.labels = labels;
			}

			await this.memoryModule.getDocumentMemory()?.updateDocument(id, updates);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	/**
	 * Updates only a single slot's workflow executionVariables (merge, not
	 * replace). Exists as a separate endpoint so variable edits don't have to
	 * round-trip the whole document — full-document update payloads can be
	 * blocked by customer-side network policies (WAF) inspecting the body.
	 */
	public handleUpdateSlotVariables = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id, slotId } = req.params as { id: string; slotId: string };
			const document = await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			const slot = document.slots?.find((s) => s.slotId === slotId);
			if (!slot) {
				throw new AinHttpError(
					StatusCodes.NOT_FOUND,
					"Document slot not found",
				);
			}
			if (slot.binding?.type !== "WORKFLOW") {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					"Slot has no workflow binding",
				);
			}

			const { executionVariables } = req.body as {
				executionVariables?: Record<string, unknown>;
			};
			if (
				!executionVariables ||
				typeof executionVariables !== "object" ||
				Array.isArray(executionVariables) ||
				Object.values(executionVariables).some((v) => typeof v !== "string")
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					"executionVariables must be a string-valued object",
				);
			}

			// Atomic single-slot patch (not a whole-slots rewrite): a concurrent
			// fill of another slot must not be clobbered by this edit's snapshot.
			// updateDocumentSlot bumps version/updatedAt in the same write.
			await this.memoryModule
				.getDocumentMemory()
				?.updateDocumentSlot(id, slotId, {
					binding: {
						...slot.binding,
						executionVariables: {
							...slot.binding.executionVariables,
							...(executionVariables as Record<string, string>),
						},
					},
				});
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
			await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			await this.memoryModule.getDocumentMemory()?.deleteDocument(id);
			this.schedulerService.removeDocumentAutoRefresh(id);
			res.status(StatusCodes.OK).send();
		} catch (error) {
			next(error);
		}
	};

	/**
	 * Soft delete: marks the document hidden instead of removing it. Hidden
	 * documents drop out of every read path (the provider filters them), so
	 * this is what user-facing "delete" buttons call. Hard delete stays on
	 * `delete/:id` for admin tooling.
	 */
	public handleHideDocument = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			await this.memoryModule
				.getDocumentMemory()
				?.updateDocument(id, { hidden: true });
			this.schedulerService.removeDocumentAutoRefresh(id);
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
			const { title, content, slots, labels, format, autoRefresh } =
				req.body as {
					title?: string;
					content?: string;
					slots?: DocumentSlot[];
					labels?: Record<string, string>;
					format?: DocumentFormat;
					autoRefresh?: unknown;
				};

			const now = new Date().toISOString();
			const document: Document = {
				documentId: randomUUID(),
				userId,
				title: title ?? "Untitled",
				format: format ?? DocumentFormat.MARKDOWN,
				content: content ?? "",
				slots,
				labels,
				source: DocumentSource.MANUAL,
				version: 1,
				createdAt: now,
				updatedAt: now,
			};
			if (autoRefresh !== undefined) {
				try {
					document.autoRefresh = parseAutoRefreshPayload({ autoRefresh });
				} catch (error) {
					throw new AinHttpError(
						StatusCodes.BAD_REQUEST,
						(error as Error).message,
					);
				}
			}

			const created = await documentMemory?.createDocument(document);
			// Only notify when an auto-refresh was actually set: skip the
			// scheduler call on the (default) create-without-autoRefresh path,
			// since removeDocumentAutoRefresh's no-op branch would otherwise run
			// on every single document creation for no reason.
			if (document.autoRefresh) {
				this.schedulerService.notifyDocumentAutoRefresh(created ?? document);
			}
			res.status(StatusCodes.CREATED).json(created ?? document);
		} catch (error) {
			next(error);
		}
	};

	public handleSetAutoRefresh = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const { id } = req.params as { id: string };
			await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			let autoRefresh: DocumentAutoRefresh | null;
			try {
				autoRefresh = parseAutoRefreshPayload(req.body);
			} catch (error) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					(error as Error).message,
				);
			}

			const documentMemory = this.memoryModule.getDocumentMemory();
			await documentMemory?.updateDocument(id, {
				autoRefresh,
			} as Partial<Document>);
			const updated = await documentMemory?.getDocument(id);
			if (updated) {
				this.schedulerService.notifyDocumentAutoRefresh(updated);
			}
			res.status(StatusCodes.OK).json(updated?.autoRefresh ?? null);
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
			await this.getAuthorizedDocument(
				userId,
				id,
				res.locals.authzChecked === true,
			);

			const { workflowId, executionVariables } = req.body as {
				workflowId?: string;
				executionVariables?: Record<string, string>;
			};
			const result = await this.workflowExecutionService.fillDocumentSlot(
				id,
				slotId,
				{
					workflowId,
					executionVariables,
					initiator: { type: "manual", userId },
				},
			);
			// fillDocumentSlot throws on failure, so resolving here means the
			// manual fill succeeded — reconcile it into the auto-refresh ledger
			// (never throws) so the badge and boot catch-up stay in sync.
			await this.schedulerService.reconcileManualSlotFill(id, slotId);
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
			// Same reconciliation as the non-stream fill path, wired to the
			// stream's successful completion instead of promise resolution.
			onComplete: () =>
				this.schedulerService.reconcileManualSlotFill(id, slotId),
			setup: async (signal) => {
				await this.getAuthorizedDocument(
					userId,
					id,
					res.locals.authzChecked === true,
				);
				const { workflowId, executionVariables } = req.body as {
					workflowId?: string;
					executionVariables?: Record<string, string>;
				};
				return this.workflowExecutionService.fillDocumentSlotStream(
					id,
					slotId,
					{
						workflowId,
						executionVariables,
						initiator: { type: "manual", userId },
					},
					signal,
				);
			},
		});
	};

	public handleGenerateAdviceStream = async (req: Request, res: Response) => {
		const userId = res.locals.userId || "";
		const { id } = req.params as { id: string };

		await streamEventsToSSE(req, res, {
			logLabel: "Document advice stream",
			userId,
			logContext: { documentId: id },
			setup: async (signal) => {
				await this.getAuthorizedDocument(
					userId,
					id,
					res.locals.authzChecked === true,
				);
				const { advicePrompt, adviceWorkflowId, executionVariables } =
					req.body as {
						advicePrompt?: string;
						adviceWorkflowId?: string;
						executionVariables?: Record<string, string>;
					};
				if (adviceWorkflowId) {
					return this.workflowExecutionService.generateDocumentAdviceStream(
						id,
						{ workflowId: adviceWorkflowId, executionVariables },
						signal,
					);
				}
				return this.documentAdviceService.generateAdviceStream(
					id,
					{ advicePrompt },
					signal,
				);
			},
		});
	};
}
