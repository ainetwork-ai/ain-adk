import { MCPTool } from "../mcp/tool.js";

export abstract class BaseModel {
  constructor() {
  }

  abstract fetch(userMessage: string, intentPrompt?: string): Promise<any>;
  abstract fetchWithContextMessage(messages: any[], tools?: MCPTool[]): Promise<any>;
}