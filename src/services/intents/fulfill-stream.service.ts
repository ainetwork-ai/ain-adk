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
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";

export class IntentFulfillStreamService {
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
		params: {
			role: MessageRole;
			content: string;
			metadata?: Record<string, unknown>;
		},
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
	private async *intentFulfilling(
		query: string,
		thread: ThreadObject,
		intent?: Intent,
	): AsyncGenerator<StreamEvent> {
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

		const processList: string[] = [];

		while (true) {
			const functions = modelInstance.convertToolsToFunctions(tools);
			const responseStream = await modelInstance.fetchStreamWithContextMessage(
				messages,
				functions,
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
					const toolCallId = randomUUID();
					const toolName = toolCall.function.name;
					let selectedTool: ConnectorTool | undefined;
					for (const [index, toolTmp] of tools.entries()) {
						if (toolTmp.toolName === toolName) {
							// remove used tool to prevent infinite loop
							selectedTool = tools.splice(index, 1)[0];
							break;
						}
					}

					if (!selectedTool) {
						// it cannot be happened...
						continue;
					}

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

					loggers.intent.debug("Tool Result", { toolResult });

					processList.push(toolResult);
					modelInstance.appendMessages(messages, toolResult);

					// remove used tool to prevent infinite loop
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
	public async *intentFulfillStream(
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

			yield {
				event: "intent_process",
				data: { subquery, actionPlan: actionPlan || "" },
			};

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
