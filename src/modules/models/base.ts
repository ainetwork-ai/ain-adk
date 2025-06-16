import { ChatCompletionMessageParam } from "openai/resources";

export abstract class BaseModel {
  constructor() {
  }

  abstract fetch(): Promise<any>;

  abstract chat(userMessage: string): Promise<ChatCompletionMessageParam>;
}