import { Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPTool {
  public params: Tool;
  public enabled: boolean;

  constructor(params: Tool) {
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