import { ChatCompletionMessageParam } from "openai/resources";
import { BaseModel } from "./base.js";
import { AzureOpenAI } from "openai";

export default class OpenAIPTU extends BaseModel {
  private client: AzureOpenAI;
  private modelName: string;
  private basePrompt: string;

  constructor(baseUrl: string, apiKey: string, apiVersion: string, modelName: string, basePrompt: string) {
    super();
    this.client = new AzureOpenAI({
      baseURL: baseUrl,
      apiKey: apiKey,
      apiVersion: apiVersion,
    });
    this.modelName = modelName;
    this.basePrompt = basePrompt;
  }

  async fetch(userMessage: string, intentPrompt?: string, ) {
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
    const response = await this.chat(messages);
    return response;
  }

  async chat(messages: ChatCompletionMessageParam[]) {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
    });
  
    return response.choices?.[0]?.message;
  }
}