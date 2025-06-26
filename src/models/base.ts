import type { AgentTool } from "../intent/modules/common/tool.js";

export interface ToolCall {
	name: string;
	arguments?: Record<string, unknown>;
}
export interface FetchResponse {
	content?: string;
	toolCalls?: ToolCall[];
}

export interface IModel {
	generateMessages<M>(queries: string[], systemPrompt?: string): M[];
	expandMessages<M>(messages: M[], message: string): void;
	convertToolsToFunctions<F>(tools: AgentTool[]): F[];
	fetch<M>(messages: M[]): Promise<FetchResponse>;
	fetchWithContextMessage<M, F>(
		messages: M[],
		functions: F[],
	): Promise<FetchResponse>;
}

export abstract class BaseModel<MessageType, FunctionType> {
	abstract generateMessages(
		queries: string[],
		systemPrompt?: string,
	): MessageType[];

	abstract expandMessages(messages: MessageType[], message: string): void;

	abstract convertToolsToFunctions(tools: AgentTool[]): FunctionType[];

	abstract fetch(messages: MessageType[]): Promise<FetchResponse>;

	abstract fetchWithContextMessage(
		messages: MessageType[],
		functions: FunctionType[],
	): Promise<FetchResponse>;
}
