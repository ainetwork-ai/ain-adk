import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
	/** Map of MCP server names to their client instances */
	private mcpMap: Map<string, Client> = new Map();
	/** Map of MCP server names to their transport instances */
	private transportMap: Map<string, StdioClientTransport> = new Map();
	/** Array of all discovered tools from connected MCP servers */
	private tools: MCPTool[] = [];

	/**
	 * Connects to MCP servers based on the provided configuration.
	 *
	 * For each server in the config, establishes a connection, discovers
	 * available tools, and adds them to the module's tool collection.
	 * Skips servers that are already connected.
	 *
	 * @param mcpConfig - Configuration object mapping server names to connection details
	 * @throws Error if connection to any MCP server fails
	 */
	async addMCPConfig(mcpConfig: MCPConfig) {
		try {
			for (const [name, conf] of Object.entries(mcpConfig)) {
				// FIXME(yoojin): Need strict duplication check.
				if (this.mcpMap.get(name) && this.transportMap.get(name)) continue; // Duplicated mcp: skip

				const transport = new StdioClientTransport(conf);
				this.transportMap.set(name, transport);
				const mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
				await mcp.connect(transport);
				this.mcpMap.set(name, mcp);

				const toolsResult = await mcp.listTools();
				this.tools.push(
					...toolsResult.tools.map((tool) => {
						return new MCPTool(name, tool);
					}),
				);
			}
			loggers.mcp.info("Connected to MCP server with tools:", {
				tools: this.tools.map((tool) => tool.id),
			});
		} catch (error: unknown) {
			loggers.mcp.error("Failed to connect to MCP server:", { error });
			throw error;
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
	async useTool(tool: MCPTool, _args?: any): Promise<any> {
		const { serverName, mcpTool } = tool;
		const toolName = mcpTool.name;
		const mcp = this.mcpMap.get(serverName);

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

		loggers.mcp.debug("MCP useTool result:", toolResult);
		return result;
	}

	/**
	 * Closes all MCP client connections.
	 *
	 * Should be called when shutting down the application to ensure
	 * all MCP connections are properly closed.
	 */
	async cleanup() {
		this.mcpMap.forEach((mcp: Client) => {
			mcp.close();
		});
	}
}
