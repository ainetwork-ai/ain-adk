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
	type Intent,
	type MessageObject,
	MessageRole,
	type ThreadObject,
	type TriggeredIntent,
} from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import { createFulfillPrompt } from "../utils/fulfill.common";

export class IntentFulfillService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private a2aModule?: A2AModule;
	private mcpModule?: MCPModule;
	private onIntentFallback?: OnIntentFallback;

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
	 * Detects the intent from context.
	 *
	 * @param intents - The user's input query
	 * @param thread - The thread history
	 * @returns The detected intent
	 */
	public async *intentFulfill(
		intents: Array<TriggeredIntent>,
		thread: ThreadObject,
	): AsyncGenerator<StreamEvent> {
		const streamStartTime = Date.now();
		loggers.intentStream.info("Stream session started", {
			threadId: thread.threadId,
			intentCount: intents.length,
			startTime: new Date(streamStartTime).toISOString(),
		});

		let finalResponseText = "";

		for (let i = 0; i < intents.length; i++) {
			const triggeredIntent = intents[i];
			const { subquery = "", intent, actionPlan } = triggeredIntent;
			loggers.intent.info(`Process query: ${subquery}, ${intent?.name}`);
			loggers.intent.info(`Action plan: ${actionPlan}`);

			// only use for inference, not stored in memory
			finalResponseText !== "" &&
				thread.messages.push({
					messageId: randomUUID(),
					role: MessageRole.MODEL,
					timestamp: Date.now(),
					content: { type: "text", parts: [finalResponseText] },
					metadata: { isThinking: true },
				});

			const thinkData = {
				title: `[${getManifest().name}] ${subquery}`,
				description: actionPlan || "",
			};
			yield {
				event: "thinking_process",
				data: thinkData,
			};

			// If no intent matched and fallback handler is provided, use it
			if (!intent && this.onIntentFallback) {
				loggers.intent.info("No intent matched, calling fallback handler");
				const fallbackStream = this.onIntentFallback({
					triggeredIntent,
					thread,
				});
				if (fallbackStream !== undefined) {
					finalResponseText = "";
					for await (const event of fallbackStream) {
						if (event.event === "text_chunk" && event.data.delta) {
							finalResponseText += event.data.delta;
						}
						if (event.event === "text_chunk" && i !== intents.length - 1) {
							continue; // skip intermediate text_chunk events
						}
						yield event;
					}
					continue;
				}
			}

			const stream = this.intentFulfilling(subquery, thread, intent);

			finalResponseText = "";
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					finalResponseText += event.data.delta;
				}

				if (event.event === "text_chunk" && i !== intents.length - 1) {
					continue; // skip intermediate text_chunk events
				}
				yield event;
			}
		}

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
