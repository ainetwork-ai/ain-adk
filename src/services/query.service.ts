import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import type { IntentModule } from "@/modules/intent/intent.module";
import type { AinAgentPrompts } from "@/types/agent.js";
import { ChatRole, type SessionObject } from "@/types/memory.js";
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
	private intentModule?: IntentModule;
	private prompts?: AinAgentPrompts;

	constructor(
		modelModule: ModelModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
		memoryModule?: MemoryModule,
		intentModule?: IntentModule,
		prompts?: AinAgentPrompts,
	) {
		this.modelModule = modelModule;
		this.a2aModule = a2aModule;
		this.mcpModule = mcpModule;
		this.memoryModule = memoryModule;
		this.intentModule = intentModule;
		this.prompts = prompts;
	}

	/**
	 * Detects the intent from a user query.
	 *
	 * @param query - The user's input query
	 * @returns The detected intent (currently returns the query as-is)
	 * @todo Implement actual intent detection logic
	 */
	private async intentTriggering(
		query: string,
		sessionHistory: SessionObject,
	): Promise<string> {
		const modelInstance = this.modelModule.getModel();

		if (!this.intentModule) {
			loggers.intent.warn(
				"No intent module available, returning query as intent",
			);
			throw new Error("No intent module available");
		}

		// 인텐트 목록 가져오기
		const intents = await this.intentModule.getIntents();
		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");

		// 세션 히스토리를 문자열로 변환
		const historyMessages = Object.entries(sessionHistory.chats)
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.map(([chatId, chat]) => {
				const role =
					chat.role === "USER"
						? "사용자"
						: chat.role === "MODEL"
							? "어시스턴트"
							: "시스템";
				const content = Array.isArray(chat.content.parts)
					? chat.content.parts.join(" ")
					: String(chat.content.parts);
				return `${role}: """${content}"""`;
			})
			.join("\n");

		const systemPrompt = `당신은 사용자의 의도를 정확히 파악하는 전문가입니다.

사용 가능한 의도 목록:
${intentList}

위의 의도 목록 중에서만 선택하여 답변하세요. 
정확히 일치하는 의도 이름만 반환하세요. 다른 설명이나 추가 텍스트는 포함하지 마세요.`;

		const userMessage = `다음은 사용자와의 대화 기록입니다:

${historyMessages}

마지막 사용자 질문: "${query}"

위의 대화 기록을 바탕으로 마지막 사용자 질문의 의도가 무엇인지 판단해주세요. 
사용 가능한 의도 목록 중에서 가장 적절한 하나를 선택하여 의도 이름만 답변하세요.`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages);
		if (!response.content) {
			throw new Error("No intent detected");
		}
		const intentName = response.content.trim();
		return intentName;
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
	 * @param sessionId - Session identifier for context
	 * @param sessionHistory - Previous conversation history
	 * @returns Object containing process steps and final response
	 */
	private async intentFulfilling(
		query: string,
		sessionId: string,
		sessionHistory: SessionObject,
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
					sessionId,
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
	 * 1. Loads session history from memory
	 * 2. Detects intent from the query
	 * 3. Fulfills the intent with AI response
	 * 4. Updates conversation history
	 *
	 * @param query - The user's input query
	 * @param sessionId - Unique session identifier
	 * @returns Object containing the AI-generated response
	 */
	public async handleQuery(query: string, sessionId: string) {
		// 1. Load session history with sessionId
		const queryStartAt = Date.now();
		const memoryInstance = this.memoryModule?.getMemory();
		const sessionHistory = (await memoryInstance?.getSessionHistory(
			sessionId,
		)) || { chats: {} } /* FIXME */;

		// 2. intent triggering
		const intent = await this.intentTriggering(query, sessionHistory);
		loggers.intent.debug("intent", { intent });

		// 3. intent fulfillment
		const result = await this.intentFulfilling(
			query,
			sessionId,
			sessionHistory,
		);
		if (sessionId) {
			await memoryInstance?.updateSessionHistory(sessionId, {
				role: ChatRole.USER,
				timestamp: queryStartAt,
				content: { type: "text", parts: [query] },
			});
			await memoryInstance?.updateSessionHistory(sessionId, {
				role: ChatRole.MODEL,
				timestamp: Date.now(),
				content: { type: "text", parts: [result.response] },
			});
		}

		return { content: result.response };
	}
}
