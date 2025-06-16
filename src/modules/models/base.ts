import { ChatCompletionMessageParam } from "openai/resources";

export abstract class BaseModel {
  constructor() {
  }

  abstract fetch(userMessage: string, intentPrompt?: string): Promise<any>;
}