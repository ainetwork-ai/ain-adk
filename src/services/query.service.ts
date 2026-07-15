import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type {
	MemoryModule,
	ModelFetchOptions,
	ModelModule,
} from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
import {
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	ThreadType,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream";
import { injectAttachedDocuments } from "@/utils/attached-documents.js";
import { loggers } from "@/utils/logger.js";
import { persistTextMessage } from "@/utils/thread-messages.js";
import { sanitizeThinkingData } from "@/utils/tool-args.js";
import type { IntentFulfillService } from "./intents/fulfill.service";
import type { IntentTriggerService } from "./intents/trigger.service";
import { PIIFilterMode, type PIIService } from "./pii.service";
import generateTitlePrompt from "./prompts/generate-title";

/**
 * Service for processing user queries through the agent's AI pipeline.
 *
 * Orchestrates the query processing workflow including intent detection,
 * model inference, tool execution, and response generation. Manages
 * conversation context and coordinates between different modules.
 */
export class QueryService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private intentTriggerService: IntentTriggerService;
	private intentFulfillService: IntentFulfillService;
	private piiService?: PIIService;

	constructor(
		modelModule: ModelModule,
		memoryModule: MemoryModule,
		intentTriggerService: IntentTriggerService,
		intentFulfillService: IntentFulfillService,
		piiService?: PIIService,
	) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.intentTriggerService = intentTriggerService;
		this.intentFulfillService = intentFulfillService;
		this.piiService = piiService;
	}

	public async addTextMessage(
		userId: string,
		threadId: string,
		role: MessageRole,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await persistTextMessage(
			this.memoryModule,
			userId,
			threadId,
			role,
			content,
			metadata,
		);
	}

	public async generateTitle(
		query: string,
		options?: ModelFetchOptions,
	): Promise<string> {
		const DEFAULT_TITLE = "New Chat";
		try {
			const modelInstance = this.modelModule.getModel();
			const modelOptions = this.modelModule.getModelOptions();
			const messages = modelInstance.generateMessages({
				query,
				systemPrompt: await generateTitlePrompt(this.memoryModule),
			});
			const response = await modelInstance.fetch(
				messages,
				options ?? modelOptions,
			);
			return response.content || DEFAULT_TITLE;
		} catch (error) {
			loggers.intent.error("Error generating title", {
				error,
				query,
			});
			return DEFAULT_TITLE;
		}
	}

	public async filterThinkingDataForStorage(
		data: Extract<StreamEvent, { event: "thinking_process" }>["data"],
	): Promise<Extract<StreamEvent, { event: "thinking_process" }>["data"]> {
		const sanitized = sanitizeThinkingData(data);
		if (this.piiService?.getMode() !== PIIFilterMode.MASK) {
			return sanitized;
		}

		return {
			...sanitized,
			title: await this.piiService.filterText(sanitized.title),
			description: await this.piiService.filterText(sanitized.description),
		};
	}

	/**
	 * Main entry point for processing streaming user queries.
	 *
	 * Handles the complete query lifecycle:
	 * 1. Loads or creates thread from memory
	 * 2. Detects intent from the query
	 * 3. Fulfills the intent with streaming AI response
	 * 4. Updates conversation history in real-time
	 *
	 * @param threadMetadata - Metadata containing type, userId, and optional threadId
	 * @param threadMetadata.type - The type of thread (e.g., chat, workflow)
	 * @param threadMetadata.userId - The user's unique identifier
	 * @param threadMetadata.threadId - Optional thread identifier
	 * @param query - The user's input query
	 * @returns AsyncGenerator yielding StreamEvent objects for SSE
	 */
	public async *handleQuery(
		threadMetadata: {
			type: ThreadType;
			userId: string;
			threadId?: string;
			workflowId?: string;
			title?: string;
			options?: ModelFetchOptions;
		},
		queryData: {
			query: string;
			displayQuery?: string;
			documentIds?: string[];
		},
		isA2A?: boolean,
	): AsyncGenerator<StreamEvent> {
		const {
			type,
			userId,
			workflowId,
			title: inputTitle,
			options,
		} = threadMetadata;
		const { displayQuery } = queryData;
		// Request bodies are untyped; accept only a real array of non-empty strings.
		const documentIds = Array.isArray(queryData.documentIds)
			? queryData.documentIds.filter(
					(id): id is string => typeof id === "string" && id.length > 0,
				)
			: undefined;
		let { query } = queryData;
		const threadMemory = this.memoryModule.getThreadMemory();

		// PII filtering on input
		const piiMode = this.piiService?.getMode() ?? PIIFilterMode.DISABLED;
		if (piiMode === PIIFilterMode.REJECT && this.piiService) {
			const hasPII = await this.piiService.containsPII(query);
			if (hasPII) {
				yield {
					event: "text_chunk",
					data: { delta: "개인정보 내역은 처리할 수 없습니다." },
				};
				return;
			}
		} else if (piiMode === PIIFilterMode.MASK && this.piiService) {
			query = await this.piiService.filterText(query);
		}

		// 1. Load or create thread
		let threadId = threadMetadata.threadId;
		let thread: ThreadObject | undefined;
		if (threadId) {
			thread = await threadMemory?.getThread(userId, threadId);
			if (!thread && !isA2A) {
				throw new AinHttpError(StatusCodes.NOT_FOUND, "Thread not found");
			}
		}

		threadId ??= randomUUID();
		if (!thread) {
			const title =
				type === ThreadType.WORKFLOW && inputTitle
					? inputTitle
					: await this.generateTitle(query, options);
			const metadata: ThreadMetadata = (await threadMemory?.createThread(
				type,
				userId,
				threadId,
				title,
				workflowId,
			)) || { type, userId, threadId, title, workflowId };
			thread = { ...metadata, messages: [] };
			loggers.intent.info(`Create new thread: ${threadId}`);
			yield {
				event: "thread_id",
				data: { type, userId, threadId, title, workflowId },
			};
		}

		// 2. intent triggering
		const triggerResult = await this.intentTriggerService.intentTriggering(
			query,
			thread,
		);
		const { intents: triggeredIntents, needsAggregation } = triggerResult;
		loggers.intent.debug("Triggered intents", {
			triggeredIntents,
			needsAggregation,
		});

		// only add for storage, not for inference
		// use displayQuery for better UX in enterprise application
		await this.addTextMessage(
			userId,
			threadId,
			MessageRole.USER,
			displayQuery || query,
			{
				intents: triggeredIntents
					.filter((intent) => !!intent.intent)
					.map((intent) => ({
						id: intent.intent?.id,
						subquery: intent.subquery,
					})),
				query: !displayQuery ? undefined : query,
				documentIds: documentIds?.length ? documentIds : undefined,
			},
		);

		// Attached documents: resolve fresh content and expose it to fulfillment
		// only. Injected in-memory (never persisted); triggering above ran on the
		// short query so the body is immune to subquery rewriting.
		const piiService = this.piiService;
		const maskFilter =
			piiService && piiService.getMode() === PIIFilterMode.MASK
				? (text: string) => piiService.filterText(text)
				: undefined;
		await injectAttachedDocuments(
			this.memoryModule,
			thread,
			documentIds,
			maskFilter,
		);

		// 3. intent fulfillment (with rewrite step)
		const stream = this.intentFulfillService.intentFulfill(
			triggeredIntents,
			thread,
			query,
			needsAggregation,
		);

		for await (const event of stream) {
			yield event;
		}
	}
}
