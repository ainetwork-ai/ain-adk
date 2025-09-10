import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import { type AinAgentPrompts, AinHttpError } from "@/types/agent.js";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import {
	type Intent,
	type MessageObject,
	MessageRole,
	type ThreadMetadata,
	type ThreadObject,
	type ThreadType,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger.js";

type TriggeredIntent = {
	subquery: string;
	intent?: Intent;
	actionPlan?: string;
};

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
	 * Detects the intent from context.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns The detected intent
	 */
	private async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<Array<TriggeredIntent>> {
		const modelInstance = this.modelModule.getModel();
		const intentMemory = this.memoryModule?.getIntentMemory();
		if (!intentMemory) {
			return [{ subquery: query }];
		}

		// 인텐트 목록 가져오기
		const intents = await intentMemory.listIntents();

		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return [{ subquery: query }];
		}

		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");

		// Convert thread messages to a string
		const threadMessages = !thread
			? ""
			: thread.messages
					.sort((a, b) => a.timestamp - b.timestamp)
					.map((message: MessageObject) => {
						const role =
							message.role === "USER"
								? "User"
								: message.role === "MODEL"
									? "Assistant"
									: "System";
						const content = Array.isArray(message.content.parts)
							? message.content.parts.join(" ")
							: String(message.content.parts);
						return `${role}: """${content}"""`;
					})
					.join("\n");

		const systemPrompt = `You are an expert in accurately identifying user intentions.

Available intent list:
${intentList}

Please select and answer only from the above intent list. 
Please return only the exact intent name without any additional explanations or text.`;

		const userMessage = `The following is the conversation history with the user:

${threadMessages}

Last user question: "${query}"

Based on the above conversation history, analyze the last user question and identify all relevant intents.

Instructions:
1. First, decompose the last user question into action-based subqueries (each representing a distinct action or task)
2. Then, map each subquery to its corresponding intent from the available intent list
3. For each subquery, provide a 2-3 sentence summary of what actions will be performed
4. Multiple intents can be identified if the question covers various topics or actions
5. Maintain the logical sequence of the original question when splitting into subqueries
6. If any subquery doesn't match any intent in the available list, map it to "default" intent

Output Format:
Return the results as a JSON array with the following structure:
[
  {
    "subquery": "<subquery_1>",
    "intentName": "<intent_name_1>",
		"actionPlan": "<2-3 sentence description of what will be done for this subquery>"
	},
  {
    "subquery": "<subquery_2>",
    "intentName": "<intent_name_2>",
		"actionPlan": "<2-3 sentence description of what will be done for this subquery>"
  },
  ...
]

Requirements:
- Each subquery should represent a single, actionable task or request
- Preserve the original meaning and context when splitting queries
- Select only from the provided intent list
- Use "default" as the intent value for any subquery that doesn't match available intents.`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return [{ subquery: query }];
		}

		const subqueries = JSON.parse(response.content);
		const triggeredIntent: Array<TriggeredIntent> = [];
		for (const { subquery, intentName, actionPlan } of subqueries) {
			const intent = await intentMemory.getIntentByName(intentName);
			triggeredIntent.push({ subquery, intent, actionPlan });
		}

		return triggeredIntent;
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
	public async *intentFulfilling(
		query: string,
		thread: ThreadObject,
		intent?: Intent,
	): AsyncGenerator<StreamEvent> {
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

			loggers.intentStream.info("messages", { messages });

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
				for (const toolCall of assembledToolCalls) {
					const toolCallId = randomUUID();
					const toolName = toolCall.function.name;
					const selectedTool = tools.filter(
						(tool) => tool.toolName === toolName,
					)[0];

					let toolResult = "";
					if (
						this.mcpModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.MCP
					) {
						const toolArgs = JSON.parse(toolCall.function.arguments) as
							| { [x: string]: unknown }
							| undefined;
						yield {
							event: "tool_start",
							data: {
								toolCallId,
								protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
								toolName,
								toolArgs,
							},
						};
						loggers.intent.info("MCP tool call", { toolName, toolArgs });
						toolResult = await this.mcpModule.useTool(selectedTool, toolArgs);
					} else if (
						this.a2aModule &&
						selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.A2A
					) {
						yield {
							event: "tool_start",
							data: {
								toolCallId,
								protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
								toolName,
								toolArgs: null,
							},
						};
						loggers.intent.info("A2A tool call", { toolName });
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
					yield {
						event: "tool_output",
						data: {
							toolCallId,
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

		// only add for storage, not for inference
		await threadMemory?.addMessagesToThread(userId, threadId, [
			{
				messageId: randomUUID(),
				role: MessageRole.USER,
				timestamp: Date.now(),
				content: { type: "text", parts: [query] },
			},
		]);

		// 2. intent triggering
		const triggeredIntent: Array<TriggeredIntent> = await this.intentTriggering(
			query,
			thread,
		);

		// 3. intent fulfillment
		let finalResponseText = "";
		for (let i = 0; i < triggeredIntent.length; i++) {
			const { subquery, intent, actionPlan } = triggeredIntent[i];
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

			yield {
				event: "intent_process",
				data: { subquery, actionPlan: actionPlan || "" },
			};

			const stream = this.intentFulfilling(subquery, thread, intent);

			finalResponseText = "";
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					loggers.intentStream.debug("text_chunk", { event });
					finalResponseText += event.data.delta;
				}

				if (event.event === "text_chunk" && i !== triggeredIntent.length - 1) {
					continue; // skip intermediate text_chunk events
				}
				yield event;
			}
		}

		await this.addToThreadMessages(thread, {
			role: MessageRole.MODEL,
			content: finalResponseText,
		});
	}
}
