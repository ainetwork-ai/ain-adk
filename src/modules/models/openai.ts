import { ChatCompletionMessageParam } from "openai/resources";
import { BaseModel } from "./base.js";
import { AzureOpenAI } from "openai";

export default class OpenAIPTU extends BaseModel {
  private client: AzureOpenAI;
  private modelName: string;
  private systemPrompt: string;

  constructor(baseUrl: string, apiKey: string, apiVersion: string, modelName: string, systemPrompt: string) {
    super();
    this.client = new AzureOpenAI({
      baseURL: baseUrl,
      apiKey: apiKey,
      apiVersion: apiVersion,
    });
    this.modelName = modelName;
    this.systemPrompt = systemPrompt;
  }

  async fetch() {

  }

  async chat(userMessage: string) {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt.trim() },
      { role: "user", content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
    });
  
    return response.choices?.[0]?.message;
  }

  async chatWithHistory(userMessages: ChatCompletionMessageParam[]) {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt.trim() },
      ...userMessages
    ];

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
    });
  
    return response.choices?.[0]?.message;
  }
}