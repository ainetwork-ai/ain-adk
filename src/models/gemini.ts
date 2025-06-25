import {
	type ContentListUnion,
	type FunctionCall,
	type FunctionDeclaration,
	GoogleGenAI,
} from "@google/genai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
} from "openai/resources";
import type { A2ATool } from "@/intent/modules/a2a/tool.js";
import type { AgentTool } from "@/intent/modules/common/tool.js";
import { PROTOCOL_TYPE } from "@/intent/modules/common/types.js";
import type { MCPTool } from "@/intent/modules/mcp/tool.js";
import { BaseModel } from "./base.js";

export default class GeminiModel extends BaseModel {
	private client: GoogleGenAI;
	private modelName: string;

	constructor(apiKey: string, modelName: string) {
		super();
		this.client = new GoogleGenAI({ apiKey });
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
		tools: AgentTool[],
	): Promise<any> {
		let functions: FunctionDeclaration[] = [];
		const contents: ContentListUnion = messages.map((message) => {
			const elem = {} as any;
			elem.role = message.role === "system" ? "model" : "user";
			if (typeof message.content === "string") {
				elem.parts = [{ text: message.content as string }];
			}
			//TODO: support other message content type
			return elem;
		});

		if (tools && tools.length > 0) {
			functions = this.convertToolsToFunctions(tools);
		}

		if (functions.length > 0) {
			return await this.chooseFunctions(contents, functions);
		}
		return await this.chat(contents);
	}

	async chat(contents: ContentListUnion) {
		const response = await this.client.models.generateContent({
			model: this.modelName,
			contents,
		});

		return response.text;
	}

	async chooseFunctions(
		contents: ContentListUnion,
		tools: FunctionDeclaration[],
	) {
		const response = await this.client.models.generateContent({
			model: this.modelName,
			contents,
			config: {
				tools: [
					{
						functionDeclarations: tools,
					},
				],
			},
		});

		const tool_calls = response.functionCalls?.map((value: FunctionCall) => {
			return {
				id: value.id,
				function: {
					arguments: JSON.stringify(value.args || {}),
					name: value.name,
				},
				type: "function",
			} as ChatCompletionMessageToolCall;
		});

		return {
			content: response.text,
			tool_calls,
		};
	}

	convertToolsToFunctions(tools: AgentTool[]): FunctionDeclaration[] {
		const newTools: FunctionDeclaration[] = [];
		for (const tool of tools) {
			if (!tool.enabled) {
				continue;
			}
			if (tool.protocol === PROTOCOL_TYPE.MCP) {
				const { mcpTool, id } = tool as MCPTool;
				newTools.push({
					name: id,
					description: mcpTool.description,
					parametersJsonSchema: mcpTool.inputSchema,
				});
			} else {
				// PROTOCOL_TYPE.A2A
				const { id, card } = tool as A2ATool;
				newTools.push({
					name: id,
					description: card.description,
				});
			}
		}
		return newTools;
	}
}
