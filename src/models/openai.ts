import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources";
import { BaseModel } from "./base.js";
import { AzureOpenAI as AzuerOpenAIClient } from "openai";
import { ExtTool } from "../intent/modules/mcp/tool.js";

export default class AzureOpenAI extends BaseModel {
  private client: AzuerOpenAIClient;
  private modelName: string;
  private basePrompt: string;

  constructor(baseUrl: string, apiKey: string, apiVersion: string, modelName: string, basePrompt: string) {
    super();
    this.client = new AzuerOpenAIClient({
      baseURL: baseUrl,
      apiKey: apiKey,
      apiVersion: apiVersion,
    });
    this.modelName = modelName;
    this.basePrompt = basePrompt;
  }

  async fetch(userMessage: string, intentPrompt?: string) {
    const systemPrompt = `
    ${this.basePrompt}

    <Knowledge>
    ${
      // NOTE(yoojin): Temporary add intent.
      intentPrompt
    }
    </Knowledge>
    `;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt.trim()},
      { role: "user", content: userMessage },
    ];

    return await this.chat(messages);
  }

  async fetchWithContextMessage(messages: ChatCompletionMessageParam[], tools?: ExtTool[]) {
    let functions: ChatCompletionTool[] = [];

    if (tools && tools.length > 0) {
      functions = this.convertToolsToFunctions(tools);
    }

    if (Object.keys(functions).length > 0) {
      return await this.chooseFunctions(messages, functions);
    }
    return await this.chat(messages);
  }

  async chat(messages: ChatCompletionMessageParam[]) {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
    });
  
    return response.choices?.[0]?.message;
  }

  async chooseFunctions(messages: ChatCompletionMessageParam[], functions: ChatCompletionTool[]) {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      tools: functions,
      tool_choice: "auto"
    });
  
    return response.choices?.[0]?.message;
  }

  convertToolsToFunctions(tools: ExtTool[]): ChatCompletionTool[] {
    return tools.map((tool) => {
      const { params, id } = tool;
      return {
        type: "function",
        function: {
          name: id,
          description: params.description,
          parameters: params.inputSchema,
        }
      }
    });;
  }
}