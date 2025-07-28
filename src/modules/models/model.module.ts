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
	abstract appendMessages(messages: MessageType[], message: string): void;

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

/**
 * Module for managing multiple AI model implementations.
 *
 * Allows registration of multiple models and provides a unified interface
 * for accessing them. Supports setting a default model for convenience.
 *
 * @example
 * ```typescript
 * const modelModule = new ModelModule();
 * modelModule.addModel("gpt-4", new OpenAIModel("gpt-4"), true);
 * modelModule.addModel("gemini", new GeminiModel("gemini-pro"));
 *
 * const defaultModel = modelModule.getModel();
 * const specificModel = modelModule.getModel("gemini");
 * ```
 */
export class ModelModule {
	/** Registry of available models indexed by name */
	private models: { [name: string]: BaseModel<unknown, unknown> } = {};
	/** Name of the default model to use when none specified */
	private defaultModelName?: string;

	/**
	 * Registers a new model with the module.
	 *
	 * @param name - Unique identifier for the model
	 * @param model - Model instance implementing BaseModel
	 * @param isDefault - Whether to set this as the default model
	 */
	public addModel(
		name: string,
		model: BaseModel<unknown, unknown>,
		isDefault?: boolean,
	) {
		this.models[name] = model;
		if (isDefault || !this.defaultModelName) {
			this.defaultModelName = name;
		}
	}

	/**
	 * Retrieves a model by name or returns the default model.
	 *
	 * @param name - Optional model name to retrieve
	 * @returns The requested model or default model if name not provided
	 * @throws Error if no default model is set and name is not provided
	 */
	public getModel(name?: string): BaseModel<unknown, unknown> {
		if (!this.defaultModelName) {
			throw Error("No default model");
		}

		if (!name || !this.models[name]) {
			return this.models[this.defaultModelName];
		}
		return this.models[name];
	}

	/**
	 * Returns information about all registered models.
	 *
	 * @returns Object containing all models and the default model name
	 */
	public getModelList() {
		return {
			models: Object.keys(this.models),
			defaultModelName: this.defaultModelName,
		};
	}
}
