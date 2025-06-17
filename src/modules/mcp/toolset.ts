import { MCPTool } from "./tool.js";

export class MCPToolset {
  public tools: {[key: string]: MCPTool}

  constructor() {
    this.tools = {};
  }

  public addTool(key: string, tool: MCPTool): void {
    if (this.tools[key]) {
      throw new Error(`Tool with key "${key}" already exists.`);
    }
    this.tools[key] = tool;
  }

  public removeTool(key: string): void {
    if (!this.tools[key]) {
      throw new Error(`Tool with key "${key}" does not exist.`);
    }
    delete this.tools[key];
  }
}