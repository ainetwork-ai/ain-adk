import { randomUUID } from "node:crypto";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules";
import type { AinAgentPrompts } from "@/types/agent";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import {
	type Intent,
	type MessageObject,
	MessageRole,
	type ThreadObject,
	type TriggeredIntent,
} from "@/types/memory";
import { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";

export class IntentFulfillService {
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

	private async addToThreadMessages(
		thread: ThreadObject,
		params: { role: MessageRole; content: string; metadata?: any },
	) {
		try {
			const threadMemory = this.memoryModule?.getThreadMemory();
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
	public async intentFulfilling(
		query: string,
		thread: ThreadObject,
		intent?: Intent,
	): Promise<string> {
		const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.

${this.prompts?.agent || ""}

${this.prompts?.system || ""}

${intent?.prompt || ""}
	`.trim();

		const modelInstance = this.modelModule.getModel();
		const messages = modelInstance.generateMessages({
			query,
			thread,
			systemPrompt: systemPrompt.trim(),
		});

		const tools: ConnectorTool[] = [];
		this.mcpModule && tools.push(...this.mcpModule.getTools());
		this.a2aModule && tools.push(...(await this.a2aModule.getTools()));

		const functions = modelInstance.convertToolsToFunctions(tools);
		let finalMessage = "";

		while (true) {
			const response = await modelInstance.fetchWithContextMessage(
				messages,
				functions,
			);

			loggers.intentStream.info("messages", { messages });

			const { content, toolCalls } = response;

			if (toolCalls) {
				for (const toolCall of toolCalls) {
					const toolName = toolCall.name;
					const selectedTool = tools.filter(
						(tool) => tool.toolName === toolName,
					)[0];

					let toolResult = "";
					if (
						this.mcpModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.MCP
					) {
						const toolArgs = toolCall.arguments as
							| { [x: string]: unknown }
							| undefined;
						loggers.intent.debug("MCP tool call", { toolName, toolArgs });
						toolResult = await this.mcpModule.useTool(selectedTool, toolArgs);
					} else if (
						this.a2aModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.A2A
					) {
						toolResult = await this.a2aModule.useTool(
							selectedTool,
							query,
							thread.threadId,
						);
					} else {
						// Unrecognized tool type. It cannot be happened...
						loggers.intent.warn(
							`Unrecognized tool type: ${selectedTool.protocol}`,
						);
						continue;
					}

					loggers.intent.debug("toolResult", { toolResult });

					modelInstance.appendMessages(messages, toolResult);
				}
			} else if (content) {
				finalMessage = content;
				break;
			}
		}

		return finalMessage;
	}

	/**
	 * Detects the intent from context.
	 *
	 * @param intents - The user's input query
	 * @param thread - The thread history
	 * @returns The detected intent
	 */
	public async intentFulfill(
		intents: Array<TriggeredIntent>,
		thread: ThreadObject,
	): Promise<string> {
		let finalResponseText = "";
		for (let i = 0; i < intents.length; i++) {
			const { subquery, intent, actionPlan } = intents[i];
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
			await this.addToThreadMessages(thread, {
				role: MessageRole.MODEL,
				content: subquery,
				metadata: {
					subquery,
					isThinking: true,
					actionPlan: actionPlan,
				},
			});

			finalResponseText = await this.intentFulfilling(subquery, thread, intent);
		}

		await this.addToThreadMessages(thread, {
			role: MessageRole.MODEL,
			content: finalResponseText,
		});

		return finalResponseText;
	}
}
