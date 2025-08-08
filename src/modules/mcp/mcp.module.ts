import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { MCPConfig } from "@/types/mcp.js";
import { loggers } from "@/utils/logger.js";
import { MCPTool } from "./mcp.tool.js";

/**
 * Module for managing Model Context Protocol (MCP) server connections.
 *
 * This module handles the lifecycle of MCP client connections, discovers
 * available tools from connected servers, and provides an interface for
 * executing those tools. Multiple MCP servers can be connected simultaneously.
 *
 * @example
 * ```typescript
 * const mcpModule = new MCPModule();
 * await mcpModule.addMCPConfig({
 *   "filesystem": {
 *     command: "npx",
 *     args: ["@modelcontextprotocol/server-filesystem", "/path/to/files"]
 *   }
 * });
 *
 * const tools = mcpModule.getTools();
 * const result = await mcpModule.useTool(tools[0], { path: "/example.txt" });
 * ```
 */
export class MCPModule {
	private mcpConfigs: Map<string, MCPConfig> = new Map();
	/** Map of MCP server names to their client instances */
	private mcpClientMap: Map<string, Client> = new Map();
	/** Array of all discovered tools from connected MCP servers */
	private tools: MCPTool[] = [];

	addMCPServerConfig(configs: { [name: string]: MCPConfig }): void {
		for (const [name, config] of Object.entries(configs)) {
			this.mcpConfigs.set(name, config);
		}
	}

	async connectToServers(): Promise<void> {
		for (const [name, config] of this.mcpConfigs.entries()) {
			try {
				const mcpClient = new Client({ name, version: "1.0.0" });
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
						// It cannot be happened.
						loggers.mcp.error("Unsupported MCP config type");
						break;
				}

				this.mcpClientMap.set(name, mcpClient);
				const toolList = await mcpClient.listTools();
				const newToolList = toolList.tools.map((tool) => {
					return new MCPTool(name, tool);
				});
				this.tools.push(...newToolList);
				loggers.mcp.info("Connected to MCP server with tools:", {
					tools: newToolList.map((tool) => tool.id),
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
	getTools() {
		return this.tools;
	}

	/**
	 * Executes a tool on its corresponding MCP server.
	 *
	 * @param tool - The MCPTool instance to execute
	 * @param _args - Arguments to pass to the tool
	 * @returns Promise resolving to the tool's execution result
	 * @throws Error if the MCP server for the tool is not found
	 */
	async useTool(tool: MCPTool, _args?: any): Promise<string> {
		const { serverName, mcpTool } = tool;
		const toolName = mcpTool.name;
		const mcp = this.mcpClientMap.get(serverName);

		try {
			if (!mcp) {
				throw new Error(`Invalid MCP Tool ${serverName}-${mcpTool.name}`);
			}

			const result = await mcp.callTool({
				name: toolName,
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
		this.mcpClientMap.forEach((mcpClient: Client) => {
			mcpClient.close();
		});
	}
}
