import { BaseModel } from "@/models/base.js";

interface A2AServerConfig {
  name: string;
  description: string;
  url: string;
}

export class A2AModule {
  private model: BaseModel;
  private a2aServers: Map<string, A2AServerConfig> = new Map();

  constructor(model: BaseModel) {
    this.model = model;
  }

  public addA2AServer(config: A2AServerConfig): void {
    if (this.a2aServers.has(config.name)) {
      console.warn(`A2A server with name ${config.name} already exists. Skipping.`);
      return;
    }
    this.a2aServers.set(config.name, config);
  }
}