import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { PROTOCOL_TYPE } from "./types.js";

export class AgentTool {
  public id: string;  // MCP: `${parentName}_${params.name}` ex) notionApi_API-post-search
  public params: Tool;
  public protocol: PROTOCOL_TYPE;
  public parentName: string;
  public enabled: boolean;

  constructor(parentName: string, params: Tool, id: string, protocol: PROTOCOL_TYPE) {
    this.id = id;
    // NOTE(yoojin): Parent Toolset name. ex) notionApi
    this.parentName = parentName;
    this.protocol = protocol;
    this.params = params;
    this.enabled = true;
  }

  public enable(): void {
    this.enabled = true;
  }

  public disable(): void {
    this.enabled = false;
  }
}