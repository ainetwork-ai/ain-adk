import { AzureOpenAI as AzureOpenAIClient } from "openai";
import type {
	ChatCompletionMessage,
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "openai/resources";
import type { A2ATool } from "@/intent/modules/a2a/tool.js";
import { PROTOCOL_TYPE } from "@/intent/modules/common/types.js";
import type { MCPTool } from "@/intent/modules/mcp/tool.js";
import type { AgentTool } from "../intent/modules/common/tool.js";
import { BaseModel } from "./base.js";

export default class AzureOpenAI extends BaseModel {
	private client: AzureOpenAIClient;
	private modelName: string;

	constructor(
		baseUrl: string,
		apiKey: string,
		apiVersion: string,
		modelName: string,
	) {
		super();
		this.client = new AzureOpenAIClient({
			baseURL: baseUrl,
			apiKey: apiKey,
			apiVersion: apiVersion,
		});
		this.modelName = modelName;
	}

	async fetch(query: string, systemPrompt?: string) {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "system", content: (systemPrompt || "").trim() },
			{ role: "user", content: query },
		];

		return await this.chat(messages);
	}

	async fetchWithContextMessage(
		messages: ChatCompletionMessageParam[],
		tools?: AgentTool[],
	): Promise<ChatCompletionMessage> {
		let functions: ChatCompletionTool[] = [];

		if (tools && tools.length > 0) {
			functions = this.convertToolsToFunctions(tools);
		}

		if (functions.length > 0) {
			return await this.chooseFunctions(messages, functions);
		}
		return await this.chat(messages);
	}

	async chat(messages: ChatCompletionMessageParam[]) {
		const response = await this.client.chat.completions.create({
			model: this.modelName,
			messages,
		});

		return response.choices?.[0]?.message;
	}

	async chooseFunctions(
		messages: ChatCompletionMessageParam[],
		functions: ChatCompletionTool[],
	) {
		const response = await this.client.chat.completions.create({
			model: this.modelName,
			messages,
			tools: functions,
			tool_choice: "auto",
		});

		return response.choices?.[0]?.message;
	}

	convertToolsToFunctions(tools: AgentTool[]): ChatCompletionTool[] {
		const newTools: ChatCompletionTool[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as MCPTool;
				newTools.push({
					type: "function",
					function: {
						name: id,
						description: mcpTool.description,
						parameters: mcpTool.inputSchema,
					},
				});
			} else {
				// PROTOCOL_TYPE.A2A
				const { id, card } = tool as A2ATool;
				newTools.push({
					type: "function",
					function: {
						name: id,
						description: card.description,
					},
				});
			}
		}
		return newTools;
	}
}
