import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import type { MCPConfig } from "@/types/mcp.js";
import { loggers } from "@/utils/logger.js";
import { MCPConnector } from "./mcp.connector.js";

/**
 * Module for managing Model Context Protocol (MCP) server connections.
 *
 * This module handles the lifecycle of MCP client connections, discovers
 * available tools from connected servers, and provides an interface for
 * executing those tools. Multiple MCP servers can be connected simultaneously.
 */
export class MCPModule {
	private mcpConnectors: Map<string, MCPConnector> = new Map();

	addMCPConnector(configs: { [name: string]: MCPConfig }): void {
		for (const [name, config] of Object.entries(configs)) {
			const conn = new MCPConnector(name, config);
			this.mcpConnectors.set(name, conn);
		}
	}

	private getOrCreateClient(connector: MCPConnector): MCPClient {
		connector.client ??= new MCPClient({
			name: connector.name,
			version: "1.0.0",
		});
		return connector.client;
	}

	async connectToServers(): Promise<void> {
		for (const [name, conn] of this.mcpConnectors.entries()) {
			try {
				const mcpClient = this.getOrCreateClient(conn);
				const config = conn.config;
				switch (config.type) {
					case "stdio": {
						const transport = new StdioClientTransport(config.params);
						await mcpClient.connect(transport);
						break;
					}
					case "websocket": {
						const transport = new WebSocketClientTransport(config.url);
						await mcpClient.connect(transport);
						break;
					}
					case "sse": {
						const transport = new SSEClientTransport(
							config.url,
							config.options,
						);
						await mcpClient.connect(transport);
						break;
					}
					case "streamableHttp": {
						const transport = new StreamableHTTPClientTransport(
							config.url,
							config.options,
						);
						await mcpClient.connect(transport);
						break;
					}
					default:
						// This cannot happen.
						loggers.mcp.error("Unsupported MCP config type");
						break;
				}

				const toolList = await mcpClient.listTools();
				conn.tools = toolList.tools.map((tool) => {
					return {
						toolName: `${name}-${tool.name}`, // to avoid tool name duplication
						connectorName: name,
						protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
						description: tool.description,
						inputSchema: tool.inputSchema,
					};
				});
				loggers.mcp.info("Connected to MCP server with tools:", {
					tools: conn.tools.map((tool) => tool.toolName),
				});
			} catch (error) {
				loggers.mcp.error(`Failed to connect to MCP server ${name}`, { error });
			}
		}
	}

	/**
	 * Returns all available tools from connected MCP servers.
	 *
	 * @returns Array of MCPTool instances representing available tools
	 */
	getTools(): Array<ConnectorTool> {
		const allTools: Array<ConnectorTool> = [];
		for (const conn of this.mcpConnectors.values()) {
			allTools.push(...conn.tools);
		}
		return allTools;
	}

	/**
	 * Executes a tool on its corresponding MCP server.
	 *
	 * @param tool - The MCPTool instance to execute
	 * @param _args - Arguments to pass to the tool
	 * @returns Promise resolving to the tool's execution result
	 * @throws Error if the MCP server for the tool is not found
	 */
	async useTool(tool: ConnectorTool, _args?: any): Promise<string> {
		const { connectorName, toolName } = tool;
		const client = this.mcpConnectors.get(connectorName)?.client;

		try {
			if (!client) {
				throw new Error(`Invalid MCP Tool ${toolName}`);
			}

			// `${name}-${tool.name}` => tool.name
			const mcpToolName = toolName.slice(connectorName.length + 1);
			const result = await client.callTool({
				name: mcpToolName,
				arguments: _args,
			});
			const toolResult =
				`[Bot Called Tool ${toolName} with args ${JSON.stringify(_args)}]\n` +
				JSON.stringify(result.content, null, 2);
			return toolResult;
		} catch (error) {
			loggers.mcp.error("Failed to call tool", { error });
			const toolResult = `[Bot Called Tool ${toolName} with args ${JSON.stringify(_args)}]\n${typeof error === "string" ? error : JSON.stringify(error, null, 2)}`;
			return toolResult;
		}
	}

	/**
	 * Closes all MCP client connections.
	 *
	 * Should be called when shutting down the application to ensure
	 * all MCP connections are properly closed.
	 */
	async cleanup() {
		for (const conn of this.mcpConnectors.values()) {
			await conn.client?.close();
		}
	}
}
