import { AzureOpenAI as AzureOpenAIClient } from "openai";
import type {
	ChatCompletionMessageParam as CCMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from "openai/resources";
import { ChatRole, type SessionObject } from "@/types/memory.js";
import type {
	FetchResponse,
	IA2ATool,
	IAgentTool,
	IMCPTool,
	ToolCall,
} from "@/types/tool.js";
import { TOOL_PROTOCOL_TYPE } from "@/types/tool.js";
import { BaseModel } from "./model.module.js";

export class AzureOpenAI extends BaseModel<CCMessageParam, ChatCompletionTool> {
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

	private getMessageRole(role: ChatRole) {
		switch (role) {
			case ChatRole.USER:
				return "user";
			case ChatRole.MODEL:
			case ChatRole.SYSTEM:
				return "system";
			default:
				return "system"; /*FIXME*/
		}
	}

	generateMessages(
		sessionHistory: SessionObject,
		query: string,
		systemPrompt?: string,
	): CCMessageParam[] {
		const messages: CCMessageParam[] = !systemPrompt
			? []
			: [{ role: "system", content: systemPrompt.trim() }];
		const sessionContent: CCMessageParam[] = Object.keys(sessionHistory).map(
			(chatId: string) => {
				const chat = sessionHistory[chatId];
				return {
					role: this.getMessageRole(chat.role),
					content: chat.content.parts[0],
				};
			},
		);
		const userContent: CCMessageParam = { role: "user", content: query };
		return messages.concat(sessionContent).concat(userContent);
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

	convertToolsToFunctions(tools: IAgentTool[]): ChatCompletionTool[] {
		const functions: ChatCompletionTool[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === TOOL_PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as IMCPTool;
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
				const { id, card } = tool as IA2ATool;
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
