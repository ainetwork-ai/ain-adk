import { randomUUID } from "node:crypto";
import { getManifest } from "@/config/manifest";
import type { MemoryModule, ModelModule } from "@/modules";
import type { OnIntentFallback } from "@/types/agent";
import {
	type CanonicalMessageObject,
	type FulfillmentResult,
	type Intent,
	MessageRole,
	type ThreadObject,
	type TriggeredIntent,
} from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import {
	createModelInputMessage,
	createTextMessage,
	extractTextContent,
} from "@/utils/message";
import { sanitizeThinkingData } from "@/utils/tool-args";
import { PIIFilterMode, type PIIService } from "../pii.service";
import fulfillPrompt from "../prompts/fulfill";
import toolSelectPrompt from "../prompts/tool-select";
import type { ToolCallingService } from "../tool-calling.service";
import { AggregateService } from "./aggregate.service";

function createFulfillmentResult(params: {
	subquery: string;
	intent?: Intent;
	actionPlan?: string;
	responseMessage: CanonicalMessageObject;
}): FulfillmentResult {
	return {
		subquery: params.subquery,
		intent: params.intent,
		actionPlan: params.actionPlan,
		responseMessage: params.responseMessage,
		response: extractTextContent(params.responseMessage),
	};
}

function createEphemeralModelContextMessage(
	message: CanonicalMessageObject,
): CanonicalMessageObject {
	return {
		...message,
		messageId: randomUUID(),
		timestamp: Date.now(),
		metadata: {
			...message.metadata,
			isThinking: true,
		},
		parts: message.parts.map((part) => ({ ...part })),
	};
}

export class IntentFulfillService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private onIntentFallback?: OnIntentFallback;
	private aggregateService: AggregateService;
	private piiService?: PIIService;
	private toolCallingService: ToolCallingService;

	constructor(
		modelModule: ModelModule,
		memoryModule: MemoryModule,
		toolCallingService: ToolCallingService,
		onIntentFallback?: OnIntentFallback,
		piiService?: PIIService,
	) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.toolCallingService = toolCallingService;
		this.onIntentFallback = onIntentFallback;
		this.aggregateService = new AggregateService(modelModule, memoryModule);
		this.piiService = piiService;
	}

	/**
	 * Fulfills the detected intent by generating a streaming response.
	 *
	 * Manages the complete inference loop including:
	 * - Loading prompts and conversation history
	 * - Collecting available tools from modules
	 * - Executing model inference with tool support
	 * - Processing tool calls iteratively until completion
	 * - Streaming results as Server-Sent Events
	 *
	 * @param query - The user's input query
	 * @param threadId - Thread identifier for context
	 * @param thread - Previous conversation history
	 * @param intent - Optional detected intent with custom prompt
	 * @returns AsyncGenerator yielding StreamEvent objects
	 */
	private async *intentFulfilling(
		query: string,
		thread: ThreadObject,
		intent?: Intent,
		input?: CanonicalMessageObject,
	): AsyncGenerator<StreamEvent, void, undefined> {
		const prompt = await fulfillPrompt(this.memoryModule, intent);

		const modelInstance = this.modelModule.getModel();
		const messages = modelInstance.generateMessages({
			query,
			input: input ?? createModelInputMessage({ text: query }),
			thread,
			systemPrompt: prompt.trim(),
		});

		loggers.intent.debug("Intent fulfillment start", {
			threadId: thread.threadId,
			messages,
		});

		const toolPrompt = await toolSelectPrompt(this.memoryModule);
		const tools = await this.toolCallingService.getTools({
			toolPrompt,
			mode: "all",
		});
		const stream = this.toolCallingService.run({
			messages,
			tools,
			query,
			thread,
			toolChoice: intent?.toolChoice === "required" ? "required" : "auto",
		});

		let result = await stream.next();
		while (!result.done) {
			yield result.value;
			result = await stream.next();
		}

		loggers.intent.debug("Intent fulfillment completed", {
			threadId: thread.threadId,
			toolCallsExecuted: result.value.toolCallsExecuted,
			intentName: intent?.name,
		});
	}

	/**
	 * Returns the appropriate stream for a triggered intent.
	 * Uses fallback handler if no intent matched and fallback is configured.
	 */
	private getIntentStream(
		triggeredIntent: TriggeredIntent,
		thread: ThreadObject,
		input?: CanonicalMessageObject,
	): AsyncGenerator<StreamEvent> | undefined {
		const { subquery = "", intent } = triggeredIntent;

		if (!intent && this.onIntentFallback) {
			loggers.intent.info("No intent matched, calling fallback handler");
			const fallbackStream = this.onIntentFallback({
				triggeredIntent,
				thread,
			});
			if (fallbackStream !== undefined) {
				return fallbackStream;
			}
		}

		return this.intentFulfilling(subquery, thread, intent, input);
	}

	/**
	 * Processes all triggered intents and generates a unified response.
	 *
	 * Workflow:
	 * 1. Process each intent sequentially, collecting results
	 * 2. Yield thinking_process events for progress visibility
	 * 3. Use AggregateService to unify results if needsAggregation is true
	 * 4. Stream the final (possibly aggregated) response
	 *
	 * @param intents - Array of triggered intents to process
	 * @param thread - The thread history
	 * @param originalQuery - The user's original query (for aggregate context)
	 * @param needsAggregation - Whether the results need to be aggregated
	 * @returns AsyncGenerator yielding StreamEvent objects
	 */
	public async *intentFulfill(
		intents: Array<TriggeredIntent>,
		thread: ThreadObject,
		originalQuery: string,
		needsAggregation: boolean,
		input?: CanonicalMessageObject,
	): AsyncGenerator<
		StreamEvent,
		CanonicalMessageObject | undefined,
		undefined
	> {
		const streamStartTime = Date.now();
		loggers.intentStream.info("Stream session started", {
			threadId: thread.threadId,
			intentCount: intents.length,
			needsAggregation,
			startTime: new Date(streamStartTime).toISOString(),
		});

		const finalMessageId = randomUUID();
		let finalResponseText = "";
		let collectionName: string | undefined;
		let finalMessageStarted = false;

		const emitFinalResponseEvent = function* (
			event: StreamEvent,
		): Generator<StreamEvent> {
			if (event.event === "text_chunk" && event.data.delta) {
				if (!finalMessageStarted) {
					finalMessageStarted = true;
					yield {
						event: "message_start",
						data: {
							messageId: finalMessageId,
							role: MessageRole.MODEL,
						},
					};
				}
				yield {
					event: "part_delta",
					data: {
						messageId: finalMessageId,
						partIndex: 0,
						part: { kind: "text" },
						delta: event.data.delta,
					},
				};
			}

			yield event;
		};

		if (intents.length <= 1) {
			// Single intent: stream response directly
			const triggeredIntent = intents[0];
			if (!triggeredIntent) {
				return;
			}

			const { subquery = "", intent, actionPlan } = triggeredIntent;
			loggers.intent.info(
				`Process single intent: ${subquery}, ${intent?.name}`,
			);
			loggers.intent.info(`Action plan: ${actionPlan}`);

			const intentThinking = this.buildIntentThinkingData(triggeredIntent);
			if (intentThinking) {
				yield { event: "thinking_process", data: intentThinking };
			}

			// Get the stream for this intent
			const stream = this.getIntentStream(triggeredIntent, thread, input);
			if (!stream) {
				return;
			}

			// Stream response directly
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					finalResponseText += event.data.delta;
				} else if (event.event === "collection_name") {
					collectionName = event.data.name;
				}
				yield* emitFinalResponseEvent(event);
			}
		} else if (!needsAggregation) {
			// Multiple intents but no aggregation needed: collect intermediate results, stream only last
			for (let i = 0; i < intents.length; i++) {
				const triggeredIntent = intents[i];
				const { subquery = "", intent, actionPlan } = triggeredIntent;
				loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
				loggers.intent.info(`Action plan: ${actionPlan}`);

				const isLastIntent = i === intents.length - 1;

				const intentThinking = this.buildIntentThinkingData(triggeredIntent);
				if (intentThinking) {
					yield { event: "thinking_process", data: intentThinking };
				}

				// Get the stream for this intent
				const stream = this.getIntentStream(triggeredIntent, thread);
				if (!stream) {
					continue;
				}

				if (isLastIntent) {
					// Stream last intent response directly
					for await (const event of stream) {
						if (event.event === "text_chunk" && event.data.delta) {
							finalResponseText += event.data.delta;
						} else if (event.event === "collection_name") {
							collectionName = event.data.name;
						}
						yield* emitFinalResponseEvent(event);
					}
				} else {
					// Collect intermediate results without streaming text_chunk
					let responseText = "";
					for await (const event of stream) {
						if (event.event === "text_chunk" && event.data.delta) {
							responseText += event.data.delta;
						} else if (event.event === "collection_name") {
							collectionName = event.data.name;
						} else if (event.event === "thinking_process") {
							// Tool execution thinking_process events are yielded immediately
							yield event;
						}
					}
					// Add intermediate result to thread context for next intent
					const responseMessage = createTextMessage({
						messageId: randomUUID(),
						role: MessageRole.MODEL,
						timestamp: Date.now(),
						text: responseText,
					});
					thread.messages.push(
						createEphemeralModelContextMessage(responseMessage),
					);
				}
			}
		} else {
			// Multi-intent mode with aggregation: collect all results then aggregate
			const fulfillmentResults: FulfillmentResult[] = [];

			for (let i = 0; i < intents.length; i++) {
				const triggeredIntent = intents[i];
				const { subquery = "", intent, actionPlan } = triggeredIntent;
				loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
				loggers.intent.info(`Action plan: ${actionPlan}`);

				// Add previous result to thread context for inference (not stored in memory)
				if (fulfillmentResults.length > 0) {
					const lastResult = fulfillmentResults[fulfillmentResults.length - 1];
					const lastResponseMessage =
						lastResult.responseMessage ??
						createTextMessage({
							messageId: randomUUID(),
							role: MessageRole.MODEL,
							timestamp: Date.now(),
							text: lastResult.response,
						});
					thread.messages.push(
						createEphemeralModelContextMessage(lastResponseMessage),
					);
				}

				const intentThinking = this.buildIntentThinkingData(triggeredIntent);
				if (intentThinking) {
					yield { event: "thinking_process", data: intentThinking };
				}

				// Get the stream for this intent
				const stream = this.getIntentStream(triggeredIntent, thread);
				if (!stream) {
					continue;
				}

				// Collect response text (don't yield text_chunk yet)
				let responseText = "";
				for await (const event of stream) {
					if (event.event === "text_chunk" && event.data.delta) {
						responseText += event.data.delta;
					} else if (event.event === "collection_name") {
						collectionName = event.data.name;
					} else if (event.event === "thinking_process") {
						// Tool execution thinking_process events are yielded immediately
						yield event;
					}
				}

				const responseMessage = createTextMessage({
					messageId: randomUUID(),
					role: MessageRole.MODEL,
					timestamp: Date.now(),
					text: responseText,
				});

				fulfillmentResults.push(
					createFulfillmentResult({
						subquery,
						intent,
						actionPlan,
						responseMessage,
					}),
				);
			}

			// Aggregate step: generate unified response
			const aggregateStream = this.aggregateService.aggregate(
				originalQuery,
				fulfillmentResults,
			);

			for await (const event of aggregateStream) {
				if (event.event === "text_chunk" && event.data.delta) {
					finalResponseText += event.data.delta;
				}
				yield* emitFinalResponseEvent(event);
			}
		}

		// PII filtering on output before saving to memory (mask mode only)
		if (this.piiService?.getMode() === PIIFilterMode.MASK) {
			finalResponseText = await this.piiService.filterText(finalResponseText);
		}

		// Save final response to memory
		const finalMessage = createTextMessage({
			messageId: finalMessageId,
			role: MessageRole.MODEL,
			timestamp: Date.now(),
			text: finalResponseText,
			metadata: collectionName ? { collectionName } : undefined,
		});

		try {
			const threadMemory = this.memoryModule.getThreadMemory();
			thread.messages.push(finalMessage);
			await threadMemory?.addMessagesToThread(thread.userId, thread.threadId, [
				finalMessage,
			]);
		} catch (error) {
			loggers.intentStream.error("Error adding message to thread", error);
		}

		const streamEndTime = Date.now();
		const streamDuration = streamEndTime - streamStartTime;

		loggers.intentStream.info("Stream session completed", {
			threadId: thread.threadId,
			duration: `${streamDuration}ms`,
			endTime: new Date(streamEndTime).toISOString(),
		});

		if (!finalMessageStarted) {
			yield {
				event: "message_start",
				data: {
					messageId: finalMessageId,
					role: MessageRole.MODEL,
				},
			};
		}
		yield {
			event: "message_complete",
			data: { message: finalMessage },
		};

		return finalMessage;
	}

	private buildIntentThinkingData(
		triggeredIntent: TriggeredIntent,
	): Extract<StreamEvent, { event: "thinking_process" }>["data"] | null {
		const { intent, actionPlan } = triggeredIntent;
		if (!intent && !actionPlan) {
			return null;
		}
		return sanitizeThinkingData({
			title: `[${getManifest().name}] ${intent?.name || "intent"}`,
			description: actionPlan || "",
		});
	}
}
