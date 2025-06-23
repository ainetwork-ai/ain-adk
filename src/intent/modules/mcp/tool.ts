import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AgentTool } from "../common/tool.js";
import { PROTOCOL_TYPE } from "../common/types.js";

export class MCPTool extends AgentTool {
	public mcpTool: Tool;
	public serverName: string;

	constructor(serverName: string, tool: Tool) {
		super(`${serverName}_${tool.name}`, PROTOCOL_TYPE.MCP);
		// NOTE(yoojin): MCP Server name. ex) notionApi
		this.serverName = serverName;
		this.mcpTool = tool;
	}
}
