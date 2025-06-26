import type { AgentTool } from "../intent/modules/common/tool.js";

export interface ToolCall {
	name: string;
	arguments?: Record<string, unknown>;
}
export interface FetchResponse {
	content?: string;
	toolCalls?: ToolCall[];
}

export abstract class BaseModel<MessageType, ToolType> {
	abstract generateMessages(
		queries: string[],
		systemPrompt?: string,
	): MessageType[];

	abstract expandMessages(messages: MessageType[], message: string): void;

	abstract convertToolsToFunctions(tools: AgentTool[]): ToolType[];

	abstract fetch(messages: MessageType[]): Promise<FetchResponse>;

	abstract fetchWithContextMessage(
		messages: MessageType[],
		tools: ToolType[],
	): Promise<FetchResponse>;
}
