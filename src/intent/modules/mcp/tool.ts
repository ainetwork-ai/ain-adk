import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPTool {
  public params: Tool;
  public mcpName: string;
  public enabled: boolean;

  constructor(mcpName: string, params: Tool) {
    this.mcpName = mcpName;
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