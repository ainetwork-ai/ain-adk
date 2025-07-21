import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { type IMCPTool, TOOL_PROTOCOL_TYPE } from "@/types/tool.js";

export class MCPTool implements IMCPTool {
	public id: string;
	public protocol: TOOL_PROTOCOL_TYPE;
	public enabled: boolean;
	public mcpTool: Tool;
	public serverName: string;

	constructor(serverName: string, tool: Tool) {
		this.id = `${serverName}_${tool.name}`;
		this.protocol = TOOL_PROTOCOL_TYPE.MCP;
		this.enabled = true;
		// NOTE(yoojin): MCP Server name. ex) notionApi
		this.serverName = serverName;
		this.mcpTool = tool;
	}

	public enable(): void {
		this.enabled = true;
	}

	public disable(): void {
		this.enabled = false;
	}
}
