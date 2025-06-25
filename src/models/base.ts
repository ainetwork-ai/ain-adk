import type { AgentTool } from "../intent/modules/common/tool.js";

export abstract class BaseModel {
	abstract fetch(userMessage: string, systemPrompt?: string): Promise<any>;
	abstract fetchWithContextMessage(
		messages: any[],
		tools?: AgentTool[],
	): Promise<any>;
}
