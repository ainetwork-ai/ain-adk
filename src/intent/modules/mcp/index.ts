import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPConfig } from "@/types/mcp.js";
import { loggers } from "@/utils/logger.js";
import { MCPTool } from "./tool.js";

export class MCPModule {
	private mcpMap: Map<string, Client> = new Map();
	private transportMap: Map<string, StdioClientTransport> = new Map();
	private tools: MCPTool[] = [];

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

	getTools() {
		return this.tools;
	}

	// biome-ignore lint/suspicious/noExplicitAny: usage of 'any' is required for dynamic tool arguments
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

	async cleanup() {
		this.mcpMap.forEach((mcp: Client) => {
			mcp.close();
		});
	}
}
