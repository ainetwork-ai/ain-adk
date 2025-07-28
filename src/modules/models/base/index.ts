import type { SessionObject } from "@/types/memory.js";
import type { FetchResponse, IAgentTool } from "@/types/tool.js";

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
	 * Generates an array of messages from session history and current query.
	 *
	 * @param sessionHistory - Previous conversation history
	 * @param query - Current user query
	 * @param systemPrompt - Optional system prompt to set context
	 * @returns Array of messages formatted for the specific model API
	 */
	abstract generateMessages(params: {
		query: string;
		sessionHistory?: SessionObject;
		systemPrompt?: string;
	}): MessageType[];

	/**
	 * Appends a new message to the existing message array.
	 *
	 * @param messages - Existing message array to expand
	 * @param message - New message content to append
	 */
	abstract expandMessages(messages: MessageType[], message: string): void;

	/**
	 * Converts protocol-agnostic tools to model-specific function format.
	 *
	 * @param tools - Array of agent tools from MCP or A2A sources
	 * @returns Array of functions in the format required by the model API
	 */
	abstract convertToolsToFunctions(tools: IAgentTool[]): FunctionType[];

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
}
