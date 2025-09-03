import type { Client as MCPClient } from "@modelcontextprotocol/sdk/client";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
	type IAgentConnector,
} from "@/types/connector.js";
import type { MCPConfig } from "@/types/mcp";

export class MCPConnector implements IAgentConnector {
	public name: string;
	public protocol: CONNECTOR_PROTOCOL_TYPE = CONNECTOR_PROTOCOL_TYPE.MCP;
	public enabled: boolean;
	public config: MCPConfig;
	public client: MCPClient | null = null;
	public tools: Array<ConnectorTool> = [];

	constructor(name: string, config: MCPConfig) {
		this.name = name;
		this.enabled = true;
		this.config = config;
	}

	public enable(): void {
		this.enabled = true;
	}

	public disable(): void {
		this.enabled = false;
	}
}
