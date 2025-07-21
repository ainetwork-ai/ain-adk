import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules/index.js";
import { ChatRole, type SessionObject } from "@/types/memory.js";
import {
	type IA2ATool,
	type IAgentTool,
	type IMCPTool,
	TOOL_PROTOCOL_TYPE,
} from "@/types/tool.js";
import { loggers } from "@/utils/logger.js";

export class QueryService {
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

	private async intentTriggering(query: string) {
		/* TODO */
		return query;
	}

	private async intentFulfilling(
		query: string,
		sessionId: string,
		sessionHistory: SessionObject,
	) {
		// 1. Load agent / system prompt from memory
		const memoryInstance = this.memoryModule?.getMemory();
		const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.

${await memoryInstance?.getAgentPrompt()}

${await memoryInstance?.getSystemPrompt()}
    `;

		const modelInstance = this.modelModule.getModel();
		const messages = modelInstance.generateMessages(
			sessionHistory,
			query,
			systemPrompt.trim(),
		);

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
					modelInstance.expandMessages(messages, toolResult);
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

	public async handleQuery(query: string, sessionId: string) {
		// 1. Load session history with sessionId
		const memoryInstance = this.memoryModule?.getMemory();
		const sessionHistory =
			(await memoryInstance?.getSessionHistory(sessionId)) || {};

		// 2. intent triggering
		const intent = this.intentTriggering(query);

		// 3. intent fulfillment
		const result = await this.intentFulfilling(
			query,
			sessionId,
			sessionHistory,
		);
		if (sessionId) {
			await memoryInstance?.updateSessionHistory(sessionId, {
				role: ChatRole.USER,
				content: { type: "text", parts: [query] },
			});
			await memoryInstance?.updateSessionHistory(sessionId, {
				role: ChatRole.MODEL,
				content: { type: "text", parts: [result.response] },
			});
		}

		return { content: result.response };
	}
}
