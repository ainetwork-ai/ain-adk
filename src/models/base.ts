import { ExtTool } from "../intent/modules/common/tool.js";

export abstract class BaseModel {
  constructor() {
  }

  abstract fetch(userMessage: string, intentPrompt?: string): Promise<any>;
  abstract fetchWithContextMessage(messages: any[], tools?: ExtTool[]): Promise<any>;
}