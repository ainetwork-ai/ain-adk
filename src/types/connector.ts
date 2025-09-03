/**
 * Supported tool protocol types in the AIN-ADK framework.
 */
export enum CONNECTOR_PROTOCOL_TYPE {
	/** Agent-to-Agent protocol */
	A2A = "A2A",
	/** Model Context Protocol */
	MCP = "MCP",
}

export type ConnectorTool = {
	toolName: string;
	connectorName: string;
	protocol: CONNECTOR_PROTOCOL_TYPE;
	description?: string;
	inputSchema?: any;
};

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
 * Base interface for all tools in the AIN-ADK framework.
 *
 * Provides a protocol-agnostic interface for tool management,
 * allowing tools from different sources (MCP, A2A) to be used
 * interchangeably throughout the system.
 *
 * @example
 * ```typescript
 * const tool: IAgentTool = {
 *   name: "search-tool",
 *   protocol: TOOL_PROTOCOL_TYPE.MCP,
 *   enabled: true,
 *   enable: () => { this.enabled = true; },
 *   disable: () => { this.enabled = false; }
 * };
 * ```
 */
export interface IAgentConnector {
	/** Unique identifier for the connector */
	name: string;
	/** Protocol type (MCP or A2A) */
	protocol: CONNECTOR_PROTOCOL_TYPE;
	/** Whether the tool is currently enabled for use */
	enabled: boolean;
	/** Enables the tool for use */
	enable: () => void;
	/** Disables the tool from being used */
	disable: () => void;
}
