import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class ExtTool {
  public id: string;  // `${parentName}_${params.name}` ex) notionApi_API-post-search
  public params: Tool;
  public protocol: "MCP" | "A2A";
  public parentName: string;
  public enabled: boolean;

  constructor(parentName: string, params: Tool, id: string, protocol: "MCP" | "A2A") {
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