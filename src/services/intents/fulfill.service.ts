import { randomUUID } from "node:crypto";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import {
	type Intent,
	type MessageObject,
	MessageRole,
	type ThreadObject,
	type TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";

export class IntentFulfillService {
	private modelModule: ModelModule;
	private a2aModule?: A2AModule;
	private mcpModule?: MCPModule;
	private memoryModule?: MemoryModule;

	constructor(
		modelModule: ModelModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
		memoryModule?: MemoryModule,
	) {
		this.modelModule = modelModule;
		this.a2aModule = a2aModule;
		this.mcpModule = mcpModule;
		this.memoryModule = memoryModule;
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
	private async intentFulfilling(
		query: string,
		thread: ThreadObject,
		intent?: Intent,
	): Promise<string> {
		const agentMemory = this.memoryModule?.getAgentMemory();
		const agentPrompt = agentMemory ? await agentMemory.getAgentPrompt() : "";

		const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.
You are a highly sophisticated automated agent that can answer user queries by utilizing various tools and resources.

There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.
You can call tools repeatedly to take actions or gather as much context as needed until you have completed the task fully.

Don't give up unless you are sure the request cannot be fulfilled with the tools you have.
It's YOUR RESPONSIBILITY to make sure that you have done all you can to collect necessary context.

If you are not sure about content or context pertaining to the user's request, use your tools to read data and gather the relevant information: do NOT guess or make up an answer.
Be THOROUGH when gathering information. Make sure you have the FULL picture before replying. Use additional tool calls or clarifying questions as needed.

Don't try to answer the user's question directly.
First break down the user's request into smaller concepts and think about the kinds of tools and queries you need to grasp each concept.

There are two <tool_type> for tools: MCP_Tool and A2A_Tool.
The tool type can be identified by the presence of "[Bot Called <tool_type> with args <tool_args>]" at the beginning of the tool result message.
After executing a tool, a final response message must be written.

Refer to the usage instructions below for each <tool_type>.

<MCP_Tool>
   Use MCP tools through tools.
   MCP tool names are structured as follows:
     {MCP_NAME}_{TOOL_NAME}
     For example, tool names for the "notionApi" mcp would be:
       notionApi_API-post-search

   Separate rules can be specified under <{MCP_NAME}> for each MCP_NAME.
</MCP_Tool>

<A2A_Tool>
   A2A_Tool is a tool that sends queries to Agents with different information than mine and receives answers. The Agent that provided the answer must be clearly indicated.
   Results from A2A_Tool are text generated after thorough consideration by the requested Agent, and are complete outputs that cannot be further developed.
   There is no need to supplement the content with the same question or use new tools.
</A2A_Tool>

${agentPrompt}

${intent?.prompt || ""}
	`.trim();

		const modelInstance = this.modelModule.getModel();
		const messages = modelInstance.generateMessages({
			query,
			thread,
			systemPrompt: systemPrompt.trim(),
		});

		loggers.intent.debug("Intent fulfillment start", {
			threadId: thread.threadId,
			messages,
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

			const { content, toolCalls } = response;
			loggers.intent.debug("Tool calls", {
				threadId: thread.threadId,
				content,
				toolCalls,
			});

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

					loggers.intent.debug("Tool Result", {
						threadId: thread.threadId,
						toolResult,
					});

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
