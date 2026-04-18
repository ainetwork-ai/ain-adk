import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type {
	MemoryModule,
	ModelFetchOptions,
	ModelModule,
} from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
import {
	type CanonicalMessageObject,
	type MessageObject,
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	ThreadType,
} from "@/types/memory.js";
import type { QueryExecutionInput } from "@/types/message-input";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger.js";
import {
	createMessageFromQueryInput,
	createModelInputMessage,
	createModelInputMessageFromQueryInput,
} from "@/utils/message";
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

	public async addToThreadMessages(
		userId: string,
		threadId: string,
		messages: Array<MessageObject>,
	) {
		const threadMemory = this.memoryModule.getThreadMemory();
		await threadMemory?.addMessagesToThread(userId, threadId, messages);
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
				input: createModelInputMessage({ text: query }),
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
		queryData: QueryExecutionInput,
		isA2A?: boolean,
	): AsyncGenerator<
		StreamEvent,
		CanonicalMessageObject | undefined,
		undefined
	> {
		const {
			type,
			userId,
			workflowId,
			title: inputTitle,
			options,
		} = threadMetadata;
		const { displayQuery, input } = queryData;
		const originalQuery = queryData.query;
		let { query } = queryData;
		const threadMemory = this.memoryModule.getThreadMemory();

		// PII filtering on input
		const piiMode = this.piiService?.getMode() ?? PIIFilterMode.DISABLED;
		if (piiMode === PIIFilterMode.REJECT && this.piiService) {
			const hasPII = await this.piiService.containsPII(query);
			if (hasPII) {
				const rejectedMessage = createMessageFromQueryInput({
					messageId: randomUUID(),
					role: MessageRole.MODEL,
					timestamp: Date.now(),
					input: {
						parts: [
							{
								kind: "text",
								text: "개인정보 내역은 처리할 수 없습니다.",
							},
						],
					},
				});
				yield {
					event: "message_start",
					data: {
						messageId: rejectedMessage.messageId,
						role: rejectedMessage.role,
					},
				};
				yield {
					event: "part_delta",
					data: {
						messageId: rejectedMessage.messageId,
						partIndex: 0,
						part: { kind: "text" },
						delta: "개인정보 내역은 처리할 수 없습니다.",
					},
				};
				yield {
					event: "text_chunk",
					data: { delta: "개인정보 내역은 처리할 수 없습니다." },
				};
				yield {
					event: "message_complete",
					data: {
						message: rejectedMessage,
					},
				};
				return rejectedMessage;
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

		const modelInput =
			input && query === originalQuery
				? createModelInputMessageFromQueryInput({ input })
				: createModelInputMessage({ text: query });

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
		await this.addToThreadMessages(userId, threadId, [
			createMessageFromQueryInput({
				messageId: randomUUID(),
				role: MessageRole.USER,
				timestamp: Date.now(),
				input: input ?? {
					parts: [{ kind: "text", text: query }],
				},
				// use displayQuery for better UX in enterprise application
				displayText: displayQuery,
				metadata: {
					intents: triggeredIntents
						.filter((intent) => !!intent.intent)
						.map((intent) => ({
							id: intent.intent?.id,
							subquery: intent.subquery,
						})),
					query: !displayQuery ? undefined : query,
				},
			}),
		]);

		// 3. intent fulfillment (with rewrite step)
		const stream = this.intentFulfillService.intentFulfill(
			triggeredIntents,
			thread,
			query,
			needsAggregation,
			modelInput,
		);

		while (true) {
			const result = await stream.next();
			if (result.done) {
				return result.value;
			}
			yield result.value;
		}
	}
}
