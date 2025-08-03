import type { AgentCard } from "@a2a-js/sdk";
import type { A2AClient } from "@a2a-js/sdk/client";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Supported tool protocol types in the AIN-ADK framework.
 */
export enum TOOL_PROTOCOL_TYPE {
	/** Agent-to-Agent protocol */
	A2A = "A2A",
	/** Model Context Protocol */
	MCP = "MCP",
}

/**
 * Represents a tool invocation request.
 */
export type ToolCall = {
	/** Name of the tool to invoke */
	name: string;
	/** Arguments to pass to the tool */
	arguments?: Record<string, unknown>;
};

/**
 * Response from a model fetch operation.
 *
 * Contains either content (text response) or tool calls (function invocations),
 * or both in the case of mixed responses.
 */
export type FetchResponse = {
	/** Text content response from the model */
	content?: string;
	/** Array of tool calls requested by the model */
	toolCalls?: ToolCall[];
};

/**
 * Normalized stream chunk interface for all LLM providers.
 *
 * This interface provides a consistent structure for stream responses
 * across different AI model providers (OpenAI, Gemini, Claude, etc.)
 */
export interface StreamChunk {
	/** Text content delta from the model */
	delta?: {
		role?: string;
		content?: string;
		tool_calls?: ToolCallDelta[];
	};
	/** Indicates if the stream has finished and why */
	finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null;
	/** Provider-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Tool call delta for streaming tool invocations
 */
export interface ToolCallDelta {
	index: number;
	id?: string;
	type?: "function";
	function?: {
		name?: string;
		arguments?: string;
	};
}

/**
 * Async iterable stream interface for LLM responses
 */
export interface LLMStream extends AsyncIterable<StreamChunk> {
	/** Cancels the stream */
	cancel?: () => void;
	/** Stream metadata */
	metadata?: Record<string, unknown>;
}

/**
 * MCP-specific tool implementation.
 *
 * Wraps an MCP tool with additional metadata and functionality
 * required for integration with the AIN-ADK framework.
 */
export interface IMCPTool extends IAgentTool {
	/** The underlying MCP tool definition */
	mcpTool: Tool;
	/** Name of the MCP server providing this tool */
	serverName: string;
}

/**
 * A2A-specific tool implementation.
 *
 * Represents a tool provided by another agent through the A2A protocol,
 * including the client connection and agent metadata.
 */
export interface IA2ATool extends IAgentTool {
	/** A2A client instance for communication with the remote agent */
	client: A2AClient;
	/** Agent card containing metadata about the remote agent */
	card: AgentCard;
}

/**
 * Base interface for all tools in the AIN-ADK framework.
 *
 * Provides a protocol-agnostic interface for tool management,
 * allowing tools from different sources (MCP, A2A) to be used
 * interchangeably throughout the system.
 *
 * @example
 * ```typescript
 * const tool: IAgentTool = {
 *   id: "search-tool",
 *   protocol: TOOL_PROTOCOL_TYPE.MCP,
 *   enabled: true,
 *   enable: () => { this.enabled = true; },
 *   disable: () => { this.enabled = false; }
 * };
 * ```
 */
export interface IAgentTool {
	/** Unique identifier for the tool */
	id: string;
	/** Protocol type (MCP or A2A) */
	protocol: TOOL_PROTOCOL_TYPE;
	/** Whether the tool is currently enabled for use */
	enabled: boolean;
	/** Enables the tool for use */
	enable: () => void;
	/** Disables the tool from being used */
	disable: () => void;
}
