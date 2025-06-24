import type { AgentCard } from "@a2a-js/sdk";
import type { BaseModel } from "@/models/base.js";
import { loggers } from "@/utils/logger.js";
import type { A2AModule } from "./modules/a2a/index.js";
import type { A2ATool } from "./modules/a2a/tool.js";
import type { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import type { MCPModule } from "./modules/mcp/index.js";
import type { MCPTool } from "./modules/mcp/tool.js";

export class IntentAnalyzer {
	private model: BaseModel;
	private a2a?: A2AModule;
	private mcp?: MCPModule;

	constructor(model: BaseModel) {
		this.model = model;
	}

	public buildAgentCard(): AgentCard {
		// FIXME: build agent card from agent's capabilities from intent
		return {
			name: "ComCom Agent",
			description:
				"An agent that can answer questions about ComCom using notion.",
			url: "http://localhost:3100/a2a",
			version: "0.0.2", // Incremented version
			capabilities: {
				streaming: true, // The new framework supports streaming
				pushNotifications: false, // Assuming not implemented for this agent yet
				stateTransitionHistory: true, // Agent uses history
			},
			// authentication: null, // Property 'authentication' does not exist on type 'AgentCard'.
			defaultInputModes: ["text"],
			defaultOutputModes: ["text", "task-status"], // task-status is a common output mode
			skills: [],
			supportsAuthenticatedExtendedCard: false,
		};
	}

	public addMCPModule(mcp: MCPModule): void {
		this.mcp = mcp;
	}

	public addA2AModule(a2a: A2AModule): void {
		this.a2a = a2a;
	}

	public async handleQuery(query: string): Promise<any> {
		const threadId = "aaaa-bbbb-cccc-dddd"; // FIXME
		// 1. intent triggering
		// TODO: Extract the user's intent using query, context, and FOL
		const intent = query; // FIXME

		// 2. intent fulfillment
		// Using the extracted intent, generate a response.
		const response = (await this.generate(intent, threadId)).response;

		return response;
	}

	public async generate(query: string, threadId: string) {
		// FIXME(yoojin): Need general system prompt for MCP tool search
		const systemMessage =
			"tool 사용에 실패하면 더이상 function을 호출하지 않는다.";

		const messages = [
			{ role: "system", content: systemMessage.trim() },
			{ role: "user", content: query },
		];

		const tools: AgentTool[] = [];

		if (this.mcp) {
			tools.push(...this.mcp.getTools());
		}
		if (this.a2a) {
			tools.push(...this.a2a.getTools());
		}

		const processList: string[] = [];
    let finalMessage = "";
		let didCallTool = false;

		while (true) {
			const response = await this.model.fetchWithContextMessage(
				messages,
				tools,
			);
			didCallTool = false;

			loggers.intent.debug("messages", { messages });

			const { content, tool_calls } = response;

			loggers.intent.debug("content", { content });
			loggers.intent.debug("tool_calls", { ...tool_calls });

			if (tool_calls) {
				const messagePayload = this.a2a?.getMessagePayload(query, threadId);

				for (const tool of tool_calls) {
					const calledFunction = tool.function;
					const toolName = calledFunction.name;
					didCallTool = true;
					const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

					let toolResult = "";
					if (this.mcp && selectedTool.protocol === PROTOCOL_TYPE.MCP) {
						const toolArgs = JSON.parse(calledFunction.arguments) as
							| { [x: string]: unknown }
							| undefined;
						loggers.intent.debug("MCP tool call", { toolName, toolArgs });
						const result = await this.mcp.useTool(
							selectedTool as MCPTool,
							toolArgs,
						);
						toolResult =
							`[Bot Called Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
							JSON.stringify(result.content, null, 2);
					} else if (this.a2a && selectedTool.protocol === PROTOCOL_TYPE.A2A) {
						const result = await this.a2a.useTool(
							selectedTool as A2ATool,
							messagePayload!,
							threadId,
						);
						toolResult = `[Bot Called Tool ${toolName}]\n${result.join("\n")}`;
					} else {
						// Unrecognized tool type. It cannot be happened...
						loggers.intent.warn(
							`Unrecognized tool type: ${selectedTool.protocol}`,
						);
						continue;
					}

					loggers.intent.debug("toolResult", { toolResult });

					processList.push(toolResult);
					messages.push({
						role: "user",
						content: toolResult,
					});
				}
			} else if (content) {
				processList.push(content);
        finalMessage = response;
			}

			if (!didCallTool) break;
		}

		const botResponse = {
			process: processList.join("\n"),
			response: finalMessage,
		};

		return botResponse;
	}
}
