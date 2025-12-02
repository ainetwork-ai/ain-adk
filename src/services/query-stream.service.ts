import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import { AinHttpError } from "@/types/agent.js";
import {
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	type ThreadType,
	type TriggeredIntent,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger.js";
import { IntentFulfillStreamService } from "./intents/fulfill-stream.service";
import { IntentTriggerService } from "./intents/trigger.service";

/**
 * Service for processing user queries through the agent's AI pipeline.
 *
 * Orchestrates the query processing workflow including intent detection,
 * model inference, tool execution, and response generation. Manages
 * conversation context and coordinates between different modules.
 */
export class QueryStreamService {
	private modelModule: ModelModule;
	private memoryModule?: MemoryModule;
	private intentTriggerService: IntentTriggerService;
	private intentFulfillStreamService: IntentFulfillStreamService;

	constructor(
		modelModule: ModelModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
		memoryModule?: MemoryModule,
	) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.intentTriggerService = new IntentTriggerService(
			modelModule,
			memoryModule,
		);
		this.intentFulfillStreamService = new IntentFulfillStreamService(
			modelModule,
			a2aModule,
			mcpModule,
			memoryModule,
		);
	}

	/**
	 * Generates a title for the conversation based on the query.
	 *
	 * @param query - The user's input query
	 * @returns Promise resolving to a generated title
	 */

	private async generateTitle(query: string): Promise<string> {
		const DEFAULT_TITLE = "New Chat";
		try {
			const modelInstance = this.modelModule.getModel();
			const messages = modelInstance.generateMessages({
				query,
				systemPrompt: `Today's date: ${new Date().toISOString().split("T")[0]} (YYYY-MM-DD format).
	You are a helpful assistant that generates titles for conversations.
  Please analyze the user's query and create a concise title that accurately reflects the conversation's core topic.
  The title must be no more than 5 words long.
  Respond with only the title. Do not include any punctuation or extra explanations.`,
			});
			const response = await modelInstance.fetch(messages);
			return response.content || DEFAULT_TITLE;
		} catch (error) {
			loggers.intentStream.error("Error generating title", {
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
	public async *handleQueryStream(
		threadMetadata: {
			type: ThreadType;
			userId: string;
			threadId?: string;
		},
		query: string,
		isA2A?: boolean,
	): AsyncGenerator<StreamEvent> {
		const { type, userId } = threadMetadata;
		const threadMemory = this.memoryModule?.getThreadMemory();

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
			const title = await this.generateTitle(query);
			const metadata: ThreadMetadata = (await threadMemory?.createThread(
				type,
				userId,
				threadId,
				title,
			)) || { type, userId, threadId, title };
			thread = { ...metadata, messages: [] };
			loggers.intent.info(`Create new thread: ${threadId}`);
			yield { event: "thread_id", data: { type, userId, threadId, title } };
		}

		// 2. intent triggering
		const triggeredIntent: Array<TriggeredIntent> =
			await this.intentTriggerService.intentTriggering(query, thread);
		loggers.intent.debug("Triggered intents", { triggeredIntent });

		// only add for storage, not for inference
		await threadMemory?.addMessagesToThread(userId, threadId, [
			{
				messageId: randomUUID(),
				role: MessageRole.USER,
				timestamp: Date.now(),
				content: { type: "text", parts: [query] },
				metadata: {
					intents: triggeredIntent
						.filter((intent) => !!intent.intent)
						.map((intent) => ({
							id: intent.intent?.id,
							subquery: intent.subquery,
						})),
				},
			},
		]);

		// 3. intent fulfillment
		const stream = this.intentFulfillStreamService.intentFulfillStream(
			triggeredIntent,
			thread,
		);

		for await (const event of stream) {
			yield event;
		}
	}
}
