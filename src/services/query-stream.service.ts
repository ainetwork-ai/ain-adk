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
		this.mcpModule && tools.push(...this.mcpModule.getTools());
		this.a2aModule && tools.push(...(await this.a2aModule.getTools()));

		const functions = modelInstance.convertToolsToFunctions(tools);

		const processList: string[] = [];

		while (true) {
			const responseStream = await modelInstance.fetchStreamWithContextMessage(
				messages,
				functions,
			);

			const assembledToolCalls: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[] = [];

			loggers.intentStream.debug("messages", { messages });

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
				assembledToolCalls,
			});

			if (assembledToolCalls.length > 0) {
				const messagePayload = this.a2aModule?.getMessagePayload(
					query,
					threadId,
				);
				for (const toolCall of assembledToolCalls) {
					const toolName = toolCall.function.name;
					const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

					let toolResult = "";
					if (
						this.mcpModule &&
						selectedTool.protocol === TOOL_PROTOCOL_TYPE.MCP
					) {
						const toolArgs = JSON.parse(toolCall.function.arguments) as
							| { [x: string]: unknown }
							| undefined;
						yield {
							event: "tool_start",
							data: { protocol: TOOL_PROTOCOL_TYPE.MCP, toolName, toolArgs },
						};
						loggers.intent.debug("MCP tool call", { toolName, toolArgs });
						toolResult = await this.mcpModule.useTool(
							selectedTool as IMCPTool,
							toolArgs,
						);
					} else if (
						this.a2aModule &&
						selectedTool.protocol === TOOL_PROTOCOL_TYPE.A2A
					) {
						yield {
							event: "tool_start",
							data: {
								protocol: TOOL_PROTOCOL_TYPE.A2A,
								toolName,
								toolArgs: null,
							},
						};
						loggers.intent.debug("A2A tool call", { toolName });
						toolResult = await this.a2aModule.useTool(
							selectedTool as IA2ATool,
							// biome-ignore lint/style/noNonNullAssertion: <a2aModule is guaranteed to be defined>
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
						data: {
							protocol: selectedTool.protocol,
							toolName,
							result: toolResult,
						},
					};
					loggers.intent.debug("toolResult", { toolResult });

					processList.push(toolResult);
					modelInstance.appendMessages(messages, toolResult);
				}
			} else {
				break;
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
	}
}
