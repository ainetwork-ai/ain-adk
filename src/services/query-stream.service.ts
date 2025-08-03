import type { Response } from "express";
import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import type { AinAgentPrompts } from "@/types/agent.js";
import { ChatRole, type SessionObject } from "@/types/memory.js";
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

	// [추가] 스트림 이벤트를 클라이언트로 전송하는 헬퍼 함수
	private writeStreamEvent = (
		res: Response,
		eventName:
			| "tool_start"
			| "tool_output"
			| "text_chunk"
			| "stream_end"
			| "error",
		data: Record<string, any>,
	) => {
		res.write(`event: ${eventName}\n`);
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

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
	 * @param sessionId - Session identifier for context
	 * @param sessionHistory - Previous conversation history
	 * @returns Object containing process steps and final response
	 */
	public async *intentFulfilling(
		query: string,
		sessionId: string,
		sessionHistory: SessionObject,
	): AsyncGenerator<StreamEvent> {
		// res 객체 제거
		try {
			const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.

${this.prompts?.agent || ""}

${this.prompts?.system || ""}
    `;

			const modelInstance = this.modelModule.getModel();
			const messages = modelInstance.generateMessages({
				query,
				sessionHistory,
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
			const finalMessage = "";
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

							// 1. 해당 인덱스의 Tool Call 객체가 처음 나타나는 경우, 기본 구조를 생성합니다.
							if (!assembledToolCalls[index]) {
								assembledToolCalls[index] = {
									id: "",
									type: "function",
									function: { name: "", arguments: "" },
								};
							}

							// 2. ID 정보를 채웁니다 (보통 첫 조각에만 포함됨).
							if (toolCallDelta.id) {
								assembledToolCalls[index].id = toolCallDelta.id;
							}

							// 3. 함수 이름 정보를 채웁니다 (보통 첫 조각에만 포함됨).
							if (toolCallDelta.function?.name) {
								assembledToolCalls[index].function.name =
									toolCallDelta.function.name;
							}

							// 4. 함수의 인자(arguments) 조각을 계속 이어 붙입니다.
							if (toolCallDelta.function?.arguments) {
								assembledToolCalls[index].function.arguments +=
									toolCallDelta.function.arguments;
							}
						}
					} else if (chunk.delta?.content) {
						// [변경점] res.write 대신 yield 사용
						yield {
							event: "text_chunk",
							data: { delta: chunk.delta.content },
						};
					}
				}

				if (didCallTool && assembledToolCalls.length > 0) {
					const messagePayload = this.a2aModule?.getMessagePayload(
						query,
						sessionId,
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
							const result = await this.mcpModule.useTool(
								selectedTool as IMCPTool,
								toolArgs,
							);
							toolResult =
								`[Bot Called MCP Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
								JSON.stringify(result.content, null, 2);
						} else if (
							this.a2aModule &&
							selectedTool.protocol === TOOL_PROTOCOL_TYPE.A2A
						) {
							const result = await this.a2aModule.useTool(
								selectedTool as IA2ATool,
								messagePayload!,
								sessionId,
							);
							toolResult = `[Bot Called A2A Tool ${toolName}]\n${result.join("\n")}`;
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
			// [변경점] 에러도 yield로 전달하여 상위 핸들러가 처리하도록 함
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
	 * Main entry point for processing user queries.
	 *
	 * Handles the complete query lifecycle:
	 * 1. Loads session history from memory
	 * 2. Detects intent from the query
	 * 3. Fulfills the intent with AI response
	 * 4. Updates conversation history
	 *
	 * @param query - The user's input query
	 * @param sessionId - Unique session identifier
	 * @returns Object containing the AI-generated response
	 */
	public async handleQuery(
		query: string,
		sessionId: string,
		res: Response,
		userId?: string,
	) {
		// 1. Load session history with sessionId
		const queryStartAt = Date.now();
		loggers.intent.info("handleQuery", {
			query,
			sessionId,
			userId,
			queryStartAt,
		});
		const sessionMemory = this.memoryModule?.getSessionMemory();
		const session = !userId
			? undefined
			: await sessionMemory?.getSession(sessionId, userId);

		// 2. intent triggering
		const intent = this.intentTriggering(query);

		try {
			// 3. intent fulfillment
			loggers.intent.info("handleQuery intentFulfilling");
			const stream = await this.intentFulfilling(
				query,
				sessionId,
				session || { chats: {} },
			);

			let finalResponseText = "";
			for await (const event of stream) {
				if (event.event === "text_chunk" && event.data.delta) {
					loggers.intent.info("handleQuery intentFulfilling text_chunk", {
						event,
					});
					finalResponseText += event.data.delta;
				}

				// 3. 모든 이벤트를 클라이언트에 실시간으로 전송
				const sseFormattedEvent = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
				res.write(sseFormattedEvent);
			}
		} catch (error) {
			loggers.intent.error("Error in handleQuery", { error });
			res.write(
				`event: error\ndata: ${JSON.stringify({ message: "Stream failed" })}\n\n`,
			);
		} finally {
			res.end();
		}
	}
}
