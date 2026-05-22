import type { ConnectorTool, FetchResponse } from "@/types/connector.js";
import type { ThreadObject } from "@/types/memory.js";
import type { AssembledToolCall, LLMStream } from "@/types/stream.js";

export type ModelFetchOptions = {
	reasoning?: "none" | "minimal" | "low" | "medium" | "high";
	verbosity?: "low" | "medium" | "high";
	toolChoice?: "auto" | "required";
};

/**
 * Arguments for {@link BaseModel.appendAssistantToolCallTurn}.
 */
export interface AssistantToolCallTurn {
	/** Text the assistant streamed in the same turn as the tool calls, or null. */
	content: string | null;
	/** Tool calls assembled from the stream. Must preserve provider-issued ids. */
	toolCalls: AssembledToolCall[];
}

/**
 * Arguments for {@link BaseModel.appendToolResult}.
 */
export interface ToolResultMessage {
	/** Matches the `id` of the corresponding {@link AssembledToolCall}. */
	toolCallId: string;
	toolName: string;
	/** Stringified result; providers wrap it in their native shape. */
	content: string;
	/** When true, the result represents a failure (skipped/error/invalid args). */
	isError?: boolean;
}

/**
 * Abstract base class for AI model implementations.
 *
 * Provides a common interface for different AI model providers (OpenAI, Gemini, etc.)
 * to integrate with the AIN-ADK framework. Each model implementation must handle
 * message formatting, tool conversion, and API communication.
 *
 * @typeParam MessageType - The message format used by the specific model API
 * @typeParam FunctionType - The function/tool format used by the specific model API
 */
export abstract class BaseModel<MessageType, FunctionType> {
	/**
	 * Generates an array of messages from thread and current query.
	 *
	 * @param query - Current user query
	 * @param thread - Previous conversation history
	 * @param systemPrompt - Optional system prompt to set context
	 * @returns Array of messages formatted for the specific model API
	 */
	abstract generateMessages(params: {
		query: string;
		thread?: ThreadObject;
		systemPrompt?: string;
	}): MessageType[];

	/**
	 * Appends the assistant's tool-call turn to the message history.
	 *
	 * Called by `ToolCallingService` immediately after the streamed assistant
	 * response is fully assembled and contains one or more tool calls, and
	 * before the corresponding tool results are pushed.
	 *
	 * Each provider must translate the input into the shape its own protocol
	 * expects (e.g. OpenAI/Azure: `{role:"assistant", content, tool_calls}`,
	 * Gemini: `{role:"model", parts:[..., {functionCall}]}`).
	 *
	 * @param messages - Existing message array to mutate
	 * @param turn - Assembled assistant turn (content + tool calls)
	 */
	abstract appendAssistantToolCallTurn(
		messages: MessageType[],
		turn: AssistantToolCallTurn,
	): void;

	/**
	 * Appends a single tool's result to the message history.
	 *
	 * Must be called once per `toolCallId` that appeared in the most recent
	 * {@link appendAssistantToolCallTurn} — including cases where the tool was
	 * skipped (unknown name, invalid arguments, etc.). Providers that enforce
	 * matched tool_calls/tool_results pairs (e.g. OpenAI/Azure) will return a
	 * 400 on the next request if this invariant is violated.
	 *
	 * @param messages - Existing message array to mutate
	 * @param result - Tool execution result keyed by `toolCallId`
	 */
	abstract appendToolResult(
		messages: MessageType[],
		result: ToolResultMessage,
	): void;

	/**
	 * Converts protocol-agnostic tools to model-specific function format.
	 *
	 * @param tools - Array of agent tools from MCP or A2A sources
	 * @returns Array of functions in the format required by the model API
	 */
	abstract convertToolsToFunctions(tools: ConnectorTool[]): FunctionType[];

	/**
	 * Fetches a response from the model API without tool support.
	 *
	 * @param messages - Array of messages to send to the model
	 * @returns Promise resolving to the model's response
	 */
	abstract fetch(
		messages: MessageType[],
		options?: ModelFetchOptions,
	): Promise<FetchResponse>;

	/**
	 * Fetches a response from the model API with tool/function support.
	 *
	 * @param messages - Array of messages to send to the model
	 * @param functions - Array of available functions/tools the model can call
	 * @returns Promise resolving to the model's response, possibly including tool calls
	 */
	abstract fetchWithContextMessage(
		messages: MessageType[],
		functions: FunctionType[],
		options?: ModelFetchOptions,
	): Promise<FetchResponse>;

	/**
	 * Fetches a streaming response from the model API with tool/function support.
	 *
	 * Returns a standardized LLMStream that can be used consistently across
	 * different AI model providers. Each implementation should convert their
	 * provider-specific stream format to the common StreamChunk interface.
	 *
	 * @param messages - Array of messages to send to the model
	 * @param functions - Array of available functions/tools the model can call
	 * @returns Promise resolving to an LLMStream for consistent iteration
	 */
	abstract fetchStreamWithContextMessage(
		messages: MessageType[],
		functions: FunctionType[],
		options?: ModelFetchOptions,
	): Promise<LLMStream>;
}
