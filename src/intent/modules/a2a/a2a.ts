import { BaseModel } from "@/models/base.js";
import { AgentCard } from "@a2a-js/sdk";
import { A2ATool } from "./a2aTool.js";

export class A2AModule {
  private model: BaseModel;
  private a2aServers: Map<string, A2ATool> = new Map();

  constructor(model: BaseModel) {
    this.model = model;
  }

  public addA2AServer(card: AgentCard): void {
    if (this.a2aServers.has(card.name)) {
      console.warn(`A2A server with name ${card.name} already exists. Skipping.`);
      return;
    }
    this.a2aServers.set(card.name, new A2ATool(card));
  }

  async processQuery(userMessage: string) {
    const messages = [
      { role: "user", content: userMessage }
    ];

    const tools = Array.from(this.a2aServers.values());
    const response = await this.model.fetchWithContextMessage(
      messages,
      tools
    );

    const { content, tool_calls } = response;
    console.log(content);
    console.log(tool_calls);
  }
}