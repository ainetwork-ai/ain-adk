import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import type { AinAgentPrompts } from "@/types/agent.js";
import { MessageRole, type ThreadObject } from "@/types/memory.js";
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
export class QueryService {
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
	private async intentFulfilling(
		query: string,
		threadId: string,
		thread?: ThreadObject,
	) {
		// 1. Load agent / system prompt from memory
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
		let finalMessage = "";
		let didCallTool = false;

		while (true) {
			const response = await modelInstance.fetchWithContextMessage(
				messages,
				functions,
			);
			didCallTool = false;

			loggers.intent.debug("messages", { messages });

			const { content, toolCalls } = response;

			loggers.intent.debug("content", { content });
			loggers.intent.debug("tool_calls", { ...toolCalls });

			if (toolCalls) {
				const messagePayload = this.a2aModule?.getMessagePayload(
					query,
					threadId,
				);

				for (const toolCall of toolCalls) {
					const toolName = toolCall.name;
					didCallTool = true;
					const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

					let toolResult = "";
					if (
						this.mcpModule &&
						selectedTool.protocol === TOOL_PROTOCOL_TYPE.MCP
					) {
						const toolArgs = toolCall.arguments as
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

					loggers.intent.debug("toolResult", { toolResult });

					processList.push(toolResult);
					modelInstance.appendMessages(messages, toolResult);
				}
			} else if (content) {
				processList.push(content);
				finalMessage = content;
			}

			if (!didCallTool) break;
		}

		const botResponse = {
			process: processList.join("\n"),
			response: finalMessage,
		};

		return botResponse;
	}

	/**
	 * Main entry point for processing user queries.
	 *
	 * Handles the complete query lifecycle:
	 * 1. Loads thread history from memory
	 * 2. Detects intent from the query
	 * 3. Fulfills the intent with AI response
	 * 4. Updates conversation history
	 *
	 * @param query - The user's input query
	 * @param threadId - Unique thread identifier
	 * @param userId - Unique user identifier
	 * @returns Object containing the AI-generated response
	 */
	public async handleQuery(query: string, threadId: string, userId?: string) {
		// 1. Load thread with threadId
		const queryStartAt = Date.now();
		const threadMemory = this.memoryModule?.getThreadMemory();
		const thread = !userId
			? undefined
			: await threadMemory?.getThread(userId, threadId);

		// 2. intent triggering
		const intent = this.intentTriggering(query);

		// 3. intent fulfillment
		const result = await this.intentFulfilling(query, threadId, thread);
		if (userId) {
			await threadMemory?.addMessageToThread(userId, threadId, {
				role: MessageRole.USER,
				timestamp: queryStartAt,
				content: { type: "text", parts: [query] },
			});
			await threadMemory?.addMessageToThread(userId, threadId, {
				role: MessageRole.MODEL,
				timestamp: Date.now(),
				content: { type: "text", parts: [result.response] },
			});
		}

		return { content: result.response };
	}
}
