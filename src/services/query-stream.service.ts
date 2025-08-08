import { randomUUID } from "node:crypto";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import type { AinAgentPrompts } from "@/types/agent.js";
import {
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	type ThreadType,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream";
import {
	type IA2ATool,
	type IAgentTool,
	type IMCPTool,
	TOOL_PROTOCOL_TYPE,
} from "@/types/tool.js";
import { loggers } from "@/utils/logger.js";

/**
 * Service for processing user queries through the agent's AI pipeline.
 *
 * Orchestrates the query processing workflow including intent detection,
 * model inference, tool execution, and response generation. Manages
 * conversation context and coordinates between different modules.
 */
export class QueryStreamService {
	private modelModule: ModelModule;
	private a2aModule?: A2AModule;
	private mcpModule?: MCPModule;
	private memoryModule?: MemoryModule;
	private prompts?: AinAgentPrompts;

	constructor(
		modelModule: ModelModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
		memoryModule?: MemoryModule,
		prompts?: AinAgentPrompts,
	) {
		this.modelModule = modelModule;
		this.a2aModule = a2aModule;
		this.mcpModule = mcpModule;
		this.memoryModule = memoryModule;
		this.prompts = prompts;
	}

	/**
	 * Detects the intent from a user query.
	 *
	 * @param query - The user's input query
	 * @returns The detected intent (currently returns the query as-is)
	 * @todo Implement actual intent detection logic
	 */
	private async intentTriggering(query: string) {
		/* TODO */
		return query;
	}

	/**
	 * Fulfills the detected intent by generating a response.
	 *
	 * Manages the complete inference loop including:
	 * - Loading prompts and conversation history
	 * - Collecting available tools from modules
	 * - Executing model inference with tool support
	 * - Processing tool calls iteratively until completion
	 *
	 * @param query - The user's input query
	 * @param threadId - Thread identifier for context
	 * @param thread - Previous conversation history
	 * @returns Object containing process steps and final response
	 */
	public async *intentFulfilling(
		query: string,
		threadId: string,
		thread?: ThreadObject,
	): AsyncGenerator<StreamEvent> {
		try {
			const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.

${this.prompts?.agent || ""}

${this.prompts?.system || ""}
    `;

			const modelInstance = this.modelModule.getModel();
			const messages = modelInstance.generateMessages({
				query,
				thread,
				systemPrompt: systemPrompt.trim(),
			});

			const tools: IAgentTool[] = [];
			if (this.mcpModule) {
				tools.push(...this.mcpModule.getTools());
			}
			if (this.a2aModule) {
				tools.push(...(await this.a2aModule.getTools()));
			}
			const functions = modelInstance.convertToolsToFunctions(tools);

			const processList: string[] = [];
			let didCallTool = false;

			while (true) {
				const responseStream =
					await modelInstance.fetchStreamWithContextMessage(
						messages,
						functions,
					);
				didCallTool = false;

				const assembledToolCalls: {
					id: string;
					type: "function";
					function: { name: string; arguments: string };
				}[] = [];

				loggers.intentStream.debug("messages", { messages });

				for await (const chunk of responseStream) {
					const delta = chunk.delta;
					if (delta?.tool_calls) {
						didCallTool = true;
						for (const toolCallDelta of delta.tool_calls) {
							const index = toolCallDelta.index;

							if (!assembledToolCalls[index]) {
								assembledToolCalls[index] = {
									id: "",
									type: "function",
									function: { name: "", arguments: "" },
								};
							}

							if (toolCallDelta.id) {
								assembledToolCalls[index].id = toolCallDelta.id;
							}

							if (toolCallDelta.function?.name) {
								assembledToolCalls[index].function.name =
									toolCallDelta.function.name;
							}

							if (toolCallDelta.function?.arguments) {
								assembledToolCalls[index].function.arguments +=
									toolCallDelta.function.arguments;
							}
						}
					} else if (chunk.delta?.content) {
						yield {
							event: "text_chunk",
							data: { delta: chunk.delta.content },
						};
					}
				}

				loggers.intentStream.debug("assembledToolCalls", {
					assembledToolCalls,
				});

				if (didCallTool && assembledToolCalls.length > 0) {
					const messagePayload = this.a2aModule?.getMessagePayload(
						query,
						threadId,
					);
					for (const toolCall of assembledToolCalls) {
						const toolName = toolCall.function.name;
						const toolArgs = JSON.parse(toolCall.function.arguments);
						const selectedTool = tools.filter(
							(tool) => tool.id === toolName,
						)[0];

						yield { event: "tool_start", data: { toolName, toolArgs } };

						let toolResult = "";

						if (
							this.mcpModule &&
							selectedTool.protocol === TOOL_PROTOCOL_TYPE.MCP
						) {
							const toolArgs = JSON.parse(toolCall.function.arguments) as
								| { [x: string]: unknown }
								| undefined;
							loggers.intent.debug("MCP tool call", { toolName, toolArgs });
							toolResult = await this.mcpModule.useTool(
								selectedTool as IMCPTool,
								toolArgs,
							);
						} else if (
							this.a2aModule &&
							selectedTool.protocol === TOOL_PROTOCOL_TYPE.A2A
						) {
							toolResult = await this.a2aModule.useTool(
								selectedTool as IA2ATool,
								messagePayload!,
								threadId,
							);
						} else {
							// Unrecognized tool type. It cannot be happened...
							loggers.intent.warn(
								`Unrecognized tool type: ${selectedTool.protocol}`,
							);
							continue;
						}
						yield {
							event: "tool_output",
							data: { toolName, result: toolResult },
						};
						loggers.intent.debug("toolResult", { toolResult });

						processList.push(toolResult);
						modelInstance.appendMessages(messages, toolResult);
					}
				}

				if (!didCallTool) break;
			}
		} catch (error) {
			loggers.intent.error("Error in intentFulfilling generator", { error });
			if (error instanceof Error) {
				yield {
					event: "error",
					data: { message: error.message || "An unknown error occurred." },
				};
			} else {
				yield {
					event: "error",
					data: { message: "An unknown error occurred." },
				};
			}
		}
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
				systemPrompt: `You are a helpful assistant that generates titles for conversations.
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
	 * Main entry point for processing user queries.
	 *
	 * Handles the complete query lifecycle:
	 * 1. Loads thread from memory
	 * 2. Detects intent from the query
	 * 3. Fulfills the intent with AI response
	 * 4. Updates conversation history
	 *
	 * @param type - The type of thread (e.g., chat, workflow)
	 * @param userId - The user's unique identifier
	 * @param threadId - Unique thread identifier
	 * @param query - The user's input query
	 * @returns Object containing the AI-generated response
	 */
	public async *handleQueryStream(
		threadMetadata: {
			type: ThreadType;
			userId: string;
			threadId?: string;
		},
		query: string,
	): AsyncGenerator<StreamEvent> {
		const { type, userId } = threadMetadata;
		const queryStartAt = Date.now();
		const threadMemory = this.memoryModule?.getThreadMemory();

		let threadId = threadMetadata.threadId;
		let thread: ThreadObject | undefined;

		if (threadId) {
			thread = await threadMemory?.getThread(type, userId, threadId);
		} else {
			threadId = randomUUID();
			const title = await this.generateTitle(query);

			const metadata =
				(await threadMemory?.createThread(type, userId, threadId, title)) ||
				({
					type,
					threadId,
					title,
					updatedAt: Date.now(),
				} as ThreadMetadata);
			loggers.intentStream.info("Create new thread", { metadata });
			yield { event: "thread_id", data: metadata };
		}

		// 2. intent triggering
		const _intent = await this.intentTriggering(query);

		try {
			// 3. intent fulfillment
			const stream = this.intentFulfilling(query, threadId, thread);

			let finalResponseText = "";
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					loggers.intentStream.debug("text_chunk", { event });
					finalResponseText += event.data.delta;
				}
				yield event;
			}

			await threadMemory?.addMessagesToThread(userId, threadId, [
				{
					role: MessageRole.USER,
					timestamp: queryStartAt,
					content: { type: "text", parts: [query] },
				},
				{
					role: MessageRole.MODEL,
					timestamp: Date.now(),
					content: { type: "text", parts: [finalResponseText] },
				},
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Stream failed";
			loggers.intentStream.error(message, { error });
			yield {
				event: "error",
				data: { message },
			};
		}
	}
}
