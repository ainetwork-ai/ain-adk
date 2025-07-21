import type { A2AClient, AgentCard } from "@a2a-js/sdk";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export enum TOOL_PROTOCOL_TYPE {
	A2A = "A2A",
	MCP = "MCP",
}

export type ToolCall = {
	name: string;
	arguments?: Record<string, unknown>;
};
export type FetchResponse = {
	content?: string;
	toolCalls?: ToolCall[];
};

export interface IMCPTool extends IAgentTool {
	mcpTool: Tool;
	serverName: string;
}

export interface IA2ATool extends IAgentTool {
	client: A2AClient;
	card: AgentCard;
}

export interface IAgentTool {
	id: string;
	protocol: TOOL_PROTOCOL_TYPE;
	enabled: boolean;
	enable: () => void;
	disable: () => void;
}
