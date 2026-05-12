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

type FinalStreamState = {
	finalMessageId: string;
	finalResponseText: string;
	collectionName?: string;
	finalMessageStarted: boolean;
};

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
	 * Routes to one of three strategies based on intent count and aggregation flag,
	 * then handles the common epilogue (PII masking, persistence, message_complete).
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

		const state: FinalStreamState = {
			finalMessageId: randomUUID(),
			finalResponseText: "",
			collectionName: undefined,
			finalMessageStarted: false,
		};

		if (intents.length <= 1) {
			const triggeredIntent = intents[0];
			if (!triggeredIntent) {
				return;
			}
			yield* this.fulfillSingleIntent(triggeredIntent, thread, input, state);
		} else if (!needsAggregation) {
			yield* this.fulfillSequential(intents, thread, state);
		} else {
			yield* this.fulfillWithAggregation(intents, thread, originalQuery, state);
		}

		// PII filtering on output before saving to memory (mask mode only)
		if (this.piiService?.getMode() === PIIFilterMode.MASK) {
			state.finalResponseText = await this.piiService.filterText(
				state.finalResponseText,
			);
		}

		const finalMessage = createTextMessage({
			messageId: state.finalMessageId,
			role: MessageRole.MODEL,
			timestamp: Date.now(),
			text: state.finalResponseText,
			metadata: state.collectionName
				? { collectionName: state.collectionName }
				: undefined,
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
		loggers.intentStream.info("Stream session completed", {
			threadId: thread.threadId,
			duration: `${streamEndTime - streamStartTime}ms`,
			endTime: new Date(streamEndTime).toISOString(),
		});

		if (!state.finalMessageStarted) {
			yield {
				event: "message_start",
				data: {
					messageId: state.finalMessageId,
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

	private async *fulfillSingleIntent(
		triggeredIntent: TriggeredIntent,
		thread: ThreadObject,
		input: CanonicalMessageObject | undefined,
		state: FinalStreamState,
	): AsyncGenerator<StreamEvent, void> {
		const { subquery = "", intent, actionPlan } = triggeredIntent;
		loggers.intent.info(`Process single intent: ${subquery}, ${intent?.name}`);
		loggers.intent.info(`Action plan: ${actionPlan}`);

		const intentThinking = this.buildIntentThinkingData(triggeredIntent);
		if (intentThinking) {
			yield { event: "thinking_process", data: intentThinking };
		}

		const stream = this.getIntentStream(triggeredIntent, thread, input);
		if (!stream) {
			return;
		}
		yield* this.consumeFinalStream(stream, state);
	}

	private async *fulfillSequential(
		intents: Array<TriggeredIntent>,
		thread: ThreadObject,
		state: FinalStreamState,
	): AsyncGenerator<StreamEvent, void> {
		for (let i = 0; i < intents.length; i++) {
			const triggeredIntent = intents[i];
			const { subquery = "", intent, actionPlan } = triggeredIntent;
			loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
			loggers.intent.info(`Action plan: ${actionPlan}`);

			const intentThinking = this.buildIntentThinkingData(triggeredIntent);
			if (intentThinking) {
				yield { event: "thinking_process", data: intentThinking };
			}

			const stream = this.getIntentStream(triggeredIntent, thread);
			if (!stream) {
				continue;
			}

			const isLastIntent = i === intents.length - 1;
			if (isLastIntent) {
				yield* this.consumeFinalStream(stream, state);
			} else {
				const responseText = yield* this.consumeIntermediateStream(
					stream,
					state,
				);
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
	}

	private async *fulfillWithAggregation(
		intents: Array<TriggeredIntent>,
		thread: ThreadObject,
		originalQuery: string,
		state: FinalStreamState,
	): AsyncGenerator<StreamEvent, void> {
		const fulfillmentResults: FulfillmentResult[] = [];

		for (const triggeredIntent of intents) {
			const { subquery = "", intent, actionPlan } = triggeredIntent;
			loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
			loggers.intent.info(`Action plan: ${actionPlan}`);

			// Inject previous result into thread context so the next intent can build on it
			const lastResult = fulfillmentResults[fulfillmentResults.length - 1];
			if (lastResult?.responseMessage) {
				thread.messages.push(
					createEphemeralModelContextMessage(lastResult.responseMessage),
				);
			}

			const intentThinking = this.buildIntentThinkingData(triggeredIntent);
			if (intentThinking) {
				yield { event: "thinking_process", data: intentThinking };
			}

			const stream = this.getIntentStream(triggeredIntent, thread);
			if (!stream) {
				continue;
			}

			const responseText = yield* this.consumeIntermediateStream(stream, state);
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

		const aggregateStream = this.aggregateService.aggregate(
			originalQuery,
			fulfillmentResults,
		);
		yield* this.consumeFinalStream(aggregateStream, state);
	}

	/**
	 * Consumes a stream destined for the final user-facing response.
	 * Accumulates text + collection name into state, and re-emits each event
	 * with the canonical message_start / part_delta wrappers prepended.
	 */
	private async *consumeFinalStream(
		stream: AsyncIterable<StreamEvent>,
		state: FinalStreamState,
	): AsyncGenerator<StreamEvent, void> {
		for await (const event of stream) {
			if (event.event === "text_chunk" && event.data.delta) {
				state.finalResponseText += event.data.delta;
			} else if (event.event === "collection_name") {
				state.collectionName = event.data.name;
			}
			yield* this.emitFinalResponseEvent(event, state);
		}
	}

	/**
	 * Consumes a stream whose text is collected for later aggregation/context,
	 * not streamed to the client. Only thinking_process events pass through;
	 * text deltas are buffered into the returned string.
	 */
	private async *consumeIntermediateStream(
		stream: AsyncIterable<StreamEvent>,
		state: FinalStreamState,
	): AsyncGenerator<StreamEvent, string> {
		let responseText = "";
		for await (const event of stream) {
			if (event.event === "text_chunk" && event.data.delta) {
				responseText += event.data.delta;
			} else if (event.event === "collection_name") {
				state.collectionName = event.data.name;
			} else if (event.event === "thinking_process") {
				yield event;
			}
		}
		return responseText;
	}

	private *emitFinalResponseEvent(
		event: StreamEvent,
		state: FinalStreamState,
	): Generator<StreamEvent> {
		if (event.event === "text_chunk" && event.data.delta) {
			if (!state.finalMessageStarted) {
				state.finalMessageStarted = true;
				yield {
					event: "message_start",
					data: {
						messageId: state.finalMessageId,
						role: MessageRole.MODEL,
					},
				};
			}
			yield {
				event: "part_delta",
				data: {
					messageId: state.finalMessageId,
					partIndex: 0,
					part: { kind: "text" },
					delta: event.data.delta,
				},
			};
		}
		yield event;
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
