import { AzureOpenAI as AzureOpenAIClient } from "openai";
import type {
	ChatCompletionMessageParam as CCMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from "openai/resources";
import type { A2ATool } from "@/intent/modules/a2a/tool.js";
import { PROTOCOL_TYPE } from "@/intent/modules/common/types.js";
import type { MCPTool } from "@/intent/modules/mcp/tool.js";
import type { AgentTool } from "../intent/modules/common/tool.js";
import { BaseModel, type FetchResponse, type ToolCall } from "./base.js";

export default class AzureOpenAI extends BaseModel<
	CCMessageParam,
	ChatCompletionTool
> {
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

	generateMessages(queries: string[], systemPrompt?: string): CCMessageParam[] {
		const messages: CCMessageParam[] = !systemPrompt
			? []
			: [{ role: "system", content: systemPrompt.trim() }];
		const userContent: CCMessageParam[] = queries.map((query: string) => {
			return { role: "user", content: query };
		});
		return messages.concat(userContent);
	}

	expandMessages(messages: CCMessageParam[], message: string): void {
		messages.push({
			role: "user",
			content: message,
		});
	}

	async fetch(messages: CCMessageParam[]): Promise<FetchResponse> {
		const response = await this.client.chat.completions.create({
			model: this.modelName,
			messages,
		});

		return {
			content: response.choices[0].message.content || undefined,
		};
	}

	async fetchWithContextMessage(
		messages: CCMessageParam[],
		functions: ChatCompletionTool[],
	): Promise<FetchResponse> {
		if (functions.length > 0) {
			const response = await this.client.chat.completions.create({
				model: this.modelName,
				messages,
				tools: functions,
				tool_choice: "auto",
			});

			const { content, tool_calls } = response.choices[0].message;

			const toolCalls: ToolCall[] | undefined = tool_calls?.map(
				(value: ChatCompletionMessageToolCall) => {
					return {
						name: value.function.name,
						// FIXME: value.function.arguments could not be a valid JSON
						arguments: JSON.parse(value.function.arguments),
					};
				},
			);

			return {
				content: content || undefined,
				toolCalls,
			};
		}
		return await this.fetch(messages);
	}

	convertToolsToFunctions(tools: AgentTool[]): ChatCompletionTool[] {
		const functions: ChatCompletionTool[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as MCPTool;
				functions.push({
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
				functions.push({
					type: "function",
					function: {
						name: id,
						description: card.description,
					},
				});
			}
		}
		return functions;
	}
}
