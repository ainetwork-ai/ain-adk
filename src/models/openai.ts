import { ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources";
import { BaseModel } from "./base.js";
import { AzureOpenAI as AzuerOpenAIClient } from "openai";
import { AgentTool } from "../intent/modules/common/tool.js";
import { PROTOCOL_TYPE } from "@/intent/modules/common/types.js";
import { MCPTool } from "@/intent/modules/mcp/mcpTool.js";
import { A2ATool } from "@/intent/modules/a2a/a2aTool.js";

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

  async fetchWithContextMessage (
    messages: ChatCompletionMessageParam[],
    tools?: AgentTool[]
  ): Promise<ChatCompletionMessage> {
    let functions: ChatCompletionTool[] = [];

    if (tools && tools.length > 0) {
      functions = await this.convertToolsToFunctions(tools);
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

  async convertToolsToFunctions(tools: AgentTool[]): Promise<ChatCompletionTool[]> {
    const newTools: ChatCompletionTool[] = [];
    for (const tool of tools) {
      if (!tool.enabled) {
        continue;
      }
      if (tool.protocol === PROTOCOL_TYPE.MCP) {
        const { mcpTool, id } = tool as MCPTool;
        newTools.push({
          type: "function",
          function: {
            name: id,
            description: mcpTool.description,
            parameters: mcpTool.inputSchema,
          }
        });
      } else { // PROTOCOL_TYPE.A2A
        const { client, id } = tool as A2ATool;
        try {
          // FIXME: inefficient
          const card = await client.getAgentCard();
          newTools.push({
            type: "function",
            function: {
              name: id,
              description: card.description,
            }
          });
        } catch (_error) {
          console.warn(`No response from Agent ${id}. Ignoring...`);
          tool.disable();
        }
      }
    }
    return newTools;
  }
}