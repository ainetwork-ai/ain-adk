import {
	type Content,
	type FunctionCall,
	type FunctionDeclaration,
	GoogleGenAI,
} from "@google/genai";
import type { A2ATool } from "@/intent/modules/a2a/tool.js";
import type { AgentTool } from "@/intent/modules/common/tool.js";
import { PROTOCOL_TYPE } from "@/intent/modules/common/types.js";
import type { MCPTool } from "@/intent/modules/mcp/tool.js";
import { ChatRole, type SessionObject } from "@/session/BaseSession.js";
import { BaseModel, type FetchResponse, type ToolCall } from "./BaseModel.js";

export default class GeminiModel extends BaseModel<
	Content,
	FunctionDeclaration
> {
	private client: GoogleGenAI;
	private modelName: string;

	constructor(apiKey: string, modelName: string) {
		super();
		this.client = new GoogleGenAI({ apiKey });
		this.modelName = modelName;
	}

	private getMessageRole(role: ChatRole) {
		switch (role) {
			case ChatRole.USER:
				return "user";
			case ChatRole.MODEL:
			case ChatRole.SYSTEM:
				return "model";
			default:
				return "model"; /*FIXME*/
		}
	}

	generateMessages(
		sessionHistory: SessionObject,
		query: string,
		systemPrompt?: string,
	): Content[] {
		const messages: Content[] = !systemPrompt
			? []
			: [{ role: "model", parts: [{ text: systemPrompt.trim() }] }];
		const sessionContent: Content[] = Object.keys(sessionHistory).map(
			(messageId: string) => {
				const message = sessionHistory[messageId];
				// TODO: check message.content.type
				return {
					role: this.getMessageRole(message.role),
					parts: [{ text: message.content.parts[0] }],
				};
			},
		);
		const userContent: Content = { role: "user", parts: [{ text: query }] };
		return messages.concat(sessionContent).concat(userContent);
	}

	expandMessages(messages: Content[], message: string): void {
		messages.push({
			role: "user",
			parts: [{ text: message }],
		});
	}

	async fetch(messages: Content[]): Promise<FetchResponse> {
		const response = await this.client.models.generateContent({
			model: this.modelName,
			contents: messages,
		});

		return { content: response.text };
	}

	async fetchWithContextMessage(
		messages: Content[],
		functions: FunctionDeclaration[],
	): Promise<FetchResponse> {
		if (functions.length > 0) {
			const response = await this.client.models.generateContent({
				model: this.modelName,
				contents: messages,
				config: {
					tools: [{ functionDeclarations: functions }],
				},
			});

			const { text, functionCalls } = response;
			const hasName = (
				value: FunctionCall,
			): value is FunctionCall & { name: string } => {
				return value.name !== undefined;
			};
			const toolCalls: ToolCall[] | undefined = functionCalls
				?.filter(hasName)
				.map((value) => {
					return {
						name: value.name,
						arguments: value.args,
					};
				});

			return {
				content: text,
				toolCalls,
			};
		}
		return await this.fetch(messages);
	}

	convertToolsToFunctions(tools: AgentTool[]): FunctionDeclaration[] {
		const functions: FunctionDeclaration[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as MCPTool;
				functions.push({
					name: id,
					description: mcpTool.description,
					parametersJsonSchema: mcpTool.inputSchema,
				});
			} else {
				// PROTOCOL_TYPE.A2A
				const { id, card } = tool as A2ATool;
				functions.push({
					name: id,
					description: card.description,
				});
			}
		}
		return functions;
	}
}
