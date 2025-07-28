import {
	type Content,
	type FunctionCall,
	type FunctionDeclaration,
	GoogleGenAI,
} from "@google/genai";
import { ChatRole, type SessionObject } from "@/types/memory.js";
import type {
	FetchResponse,
	IA2ATool,
	IAgentTool,
	IMCPTool,
	ToolCall,
} from "@/types/tool.js";
import { TOOL_PROTOCOL_TYPE } from "@/types/tool.js";
import { BaseModel } from "../base/index.js";

export class GeminiModel extends BaseModel<Content, FunctionDeclaration> {
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

	generateMessages(params: {
		query: string;
		sessionHistory?: SessionObject;
		systemPrompt?: string;
	}): Content[] {
		const { query, sessionHistory, systemPrompt } = params;
		const messages: Content[] = !systemPrompt
			? []
			: [{ role: "model", parts: [{ text: systemPrompt.trim() }] }];
		const sessionContent: Content[] = !sessionHistory
			? []
			: Object.keys(sessionHistory.chats).map((chatId: string) => {
					const chat = sessionHistory.chats[chatId];
					// TODO: check message.content.type
					return {
						role: this.getMessageRole(chat.role),
						parts: [{ text: chat.content.parts[0] }],
					};
				});
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

	convertToolsToFunctions(tools: IAgentTool[]): FunctionDeclaration[] {
		const functions: FunctionDeclaration[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === TOOL_PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as IMCPTool;
				functions.push({
					name: id,
					description: mcpTool.description,
					parametersJsonSchema: mcpTool.inputSchema,
				});
			} else {
				// PROTOCOL_TYPE.A2A
				const { id, card } = tool as IA2ATool;
				functions.push({
					name: id,
					description: card.description,
				});
			}
		}
		return functions;
	}
}
