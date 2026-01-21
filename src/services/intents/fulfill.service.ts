import { randomUUID } from "node:crypto";
import { getManifest } from "@/config/manifest";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules";
import type { OnIntentFallback } from "@/types/agent";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import {
	type FulfillmentResult,
	type Intent,
	type MessageObject,
	MessageRole,
	type ThreadObject,
	type TriggeredIntent,
} from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import { createFulfillPrompt } from "../utils/fulfill.common";
import { AggregateService } from "./aggregate.service";

export class IntentFulfillService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private a2aModule?: A2AModule;
	private mcpModule?: MCPModule;
	private onIntentFallback?: OnIntentFallback;
	private aggregateService: AggregateService;

	constructor(
		modelModule: ModelModule,
		memoryModule: MemoryModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
		onIntentFallback?: OnIntentFallback,
	) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.a2aModule = a2aModule;
		this.mcpModule = mcpModule;
		this.onIntentFallback = onIntentFallback;
		this.aggregateService = new AggregateService(modelModule);
	}

	private async addToThreadMessages(
		thread: ThreadObject,
		params: {
			role: MessageRole;
			content: string;
			metadata?: Record<string, unknown>;
		},
	) {
		try {
			const threadMemory = this.memoryModule.getThreadMemory();
			const { userId, threadId } = thread;
			const newMessage: MessageObject = {
				messageId: randomUUID(),
				role: params.role,
				timestamp: Date.now(),
				content: { type: "text", parts: [params.content] },
				metadata: params.metadata,
			};
			thread.messages.push(newMessage);
			await threadMemory?.addMessagesToThread(userId, threadId, [newMessage]);
		} catch (error) {
			loggers.intentStream.error("Error adding message to thread", error);
		}
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
	): AsyncGenerator<StreamEvent> {
		const agentMemory = this.memoryModule.getAgentMemory();
		const fulfillPrompt = await createFulfillPrompt(agentMemory, intent);

		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const messages = modelInstance.generateMessages({
			query,
			thread,
			systemPrompt: fulfillPrompt.trim(),
		});

		loggers.intent.debug("Intent fulfillment start", {
			threadId: thread.threadId,
			messages,
		});

		const tools: ConnectorTool[] = [];
		this.mcpModule && tools.push(...this.mcpModule.getTools());
		this.a2aModule && tools.push(...(await this.a2aModule.getTools()));

		const processList: string[] = [];

		while (true) {
			const functions = modelInstance.convertToolsToFunctions(tools);
			const responseStream = await modelInstance.fetchStreamWithContextMessage(
				messages,
				functions,
				modelOptions,
			);

			const assembledToolCalls: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[] = [];

			for await (const chunk of responseStream) {
				const delta = chunk.delta;
				if (delta?.tool_calls) {
					for (const { index, id, function: func } of delta.tool_calls) {
						assembledToolCalls[index] ??= {
							id: "",
							type: "function",
							function: { name: "", arguments: "" },
						};

						if (id) assembledToolCalls[index].id = id;
						if (func?.name) assembledToolCalls[index].function.name = func.name;
						if (func?.arguments)
							assembledToolCalls[index].function.arguments += func.arguments;
					}
				} else if (chunk.delta?.content) {
					yield {
						event: "text_chunk",
						data: { delta: chunk.delta.content },
					};
				}
			}

			loggers.intentStream.debug("assembledToolCalls", {
				threadId: thread.threadId,
				assembledToolCalls,
			});

			if (assembledToolCalls.length > 0) {
				for (const toolCall of assembledToolCalls) {
					const toolName = toolCall.function.name;
					let selectedTool: ConnectorTool | undefined;
					for (const [index, toolTmp] of tools.entries()) {
						if (toolTmp.toolName === toolName) {
							if (toolTmp.protocol === CONNECTOR_PROTOCOL_TYPE.A2A) {
								// remove used tool to prevent infinite loop
								selectedTool = tools.splice(index, 1)[0];
								break;
							}
							selectedTool = toolTmp;
						}
					}

					if (!selectedTool) {
						// it cannot be happened...
						continue;
					}

					const toolArgs = JSON.parse(toolCall.function.arguments);
					const thinkData = {
						title: `[${getManifest().name}] ${selectedTool.protocol} 실행: ${toolName}`,
						description: `${toolArgs.thinking_text || ""}`,
					};
					yield {
						event: "thinking_process",
						data: thinkData,
					};

					let toolResult = "";
					if (
						this.mcpModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.MCP
					) {
						loggers.intent.info("MCP tool call", { toolName, toolArgs });
						toolResult = await this.mcpModule.useTool(selectedTool, toolArgs);
					} else if (
						this.a2aModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.A2A
					) {
						loggers.intent.info("A2A tool call", { toolName });
						const a2aStream = this.a2aModule.useTool(
							selectedTool,
							query,
							thread.threadId,
						);
						// yield intermediate events and get final result
						let result = await a2aStream.next();
						while (!result.done) {
							if (result.value.event === "thinking_process") {
								yield result.value;
							}
							result = await a2aStream.next();
						}
						toolResult = result.value;
					} else {
						// Unrecognized tool type. It cannot be happened...
						loggers.intent.warn(
							`Unrecognized tool type: ${selectedTool.protocol}`,
						);
						continue;
					}

					loggers.intent.debug("Tool Result", { toolResult });

					processList.push(toolResult);
					modelInstance.appendMessages(messages, toolResult);
				}
			} else {
				break;
			}
		}

		loggers.intent.debug("Intent fulfillment completed", {
			threadId: thread.threadId,
			toolCallsExecuted: processList.length,
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

		return this.intentFulfilling(subquery, thread, intent);
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
	): AsyncGenerator<StreamEvent> {
		const streamStartTime = Date.now();
		loggers.intentStream.info("Stream session started", {
			threadId: thread.threadId,
			intentCount: intents.length,
			needsAggregation,
			startTime: new Date(streamStartTime).toISOString(),
		});

		let finalResponseText = "";

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

			// Yield thinking_process for progress visibility
			yield {
				event: "thinking_process",
				data: {
					title: `[${getManifest().name}] ${subquery}`,
					description: actionPlan || "",
				},
			};

			// Get the stream for this intent
			const stream = this.getIntentStream(triggeredIntent, thread);
			if (!stream) {
				return;
			}

			// Stream response directly
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					finalResponseText += event.data.delta;
				}
				yield event;
			}
		} else if (!needsAggregation) {
			// Multiple intents but no aggregation needed: collect intermediate results, stream only last
			for (let i = 0; i < intents.length; i++) {
				const triggeredIntent = intents[i];
				const { subquery = "", intent, actionPlan } = triggeredIntent;
				loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
				loggers.intent.info(`Action plan: ${actionPlan}`);

				const isLastIntent = i === intents.length - 1;

				// Yield thinking_process for progress visibility
				yield {
					event: "thinking_process",
					data: {
						title: `[${getManifest().name}] ${subquery}`,
						description: actionPlan || "",
					},
				};

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
						}
						yield event;
					}
				} else {
					// Collect intermediate results without streaming text_chunk
					let responseText = "";
					for await (const event of stream) {
						if (event.event === "text_chunk" && event.data.delta) {
							responseText += event.data.delta;
						} else if (event.event === "thinking_process") {
							// Tool execution thinking_process events are yielded immediately
							yield event;
						}
					}
					// Add intermediate result to thread context for next intent
					thread.messages.push({
						messageId: randomUUID(),
						role: MessageRole.MODEL,
						timestamp: Date.now(),
						content: { type: "text", parts: [responseText] },
						metadata: { isThinking: true },
					});
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
					thread.messages.push({
						messageId: randomUUID(),
						role: MessageRole.MODEL,
						timestamp: Date.now(),
						content: { type: "text", parts: [lastResult.response] },
						metadata: { isThinking: true },
					});
				}

				// Yield thinking_process for progress visibility
				yield {
					event: "thinking_process",
					data: {
						title: `[${getManifest().name}] ${subquery}`,
						description: actionPlan || "",
					},
				};

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
					} else if (event.event === "thinking_process") {
						// Tool execution thinking_process events are yielded immediately
						yield event;
					}
				}

				fulfillmentResults.push({
					subquery,
					intent,
					actionPlan,
					response: responseText,
				});
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
				yield event;
			}
		}

		// Save final response to memory
		await this.addToThreadMessages(thread, {
			role: MessageRole.MODEL,
			content: finalResponseText,
		});

		const streamEndTime = Date.now();
		const streamDuration = streamEndTime - streamStartTime;

		loggers.intentStream.info("Stream session completed", {
			threadId: thread.threadId,
			duration: `${streamDuration}ms`,
			endTime: new Date(streamEndTime).toISOString(),
		});
	}
}
