import type { ConnectorTool, FetchResponse } from "@/types/connector.js";
import type { ThreadObject } from "@/types/memory.js";
import type { LLMStream } from "@/types/stream.js";

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
	 * Appends a new message to the existing message array.
	 *
	 * @param messages - Existing message array to expand
	 * @param message - New message content to append
	 */
	abstract appendMessages(messages: MessageType[], message: string): void;

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
	abstract fetch(messages: MessageType[]): Promise<FetchResponse>;

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
	): Promise<LLMStream>;
}
