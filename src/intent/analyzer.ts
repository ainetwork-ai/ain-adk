import { BaseModel } from "@/models/base.js";
import { AgentCard } from "@a2a-js/sdk";

import { MCPClient } from "./modules/mcp/mcpClient.js";

export class IntentAnalyzer {
  private model: BaseModel;
  private mcp?: MCPClient;

  constructor(model: BaseModel) {
    this.model = model;
  }

  public buildAgentCard(): AgentCard {
    // FIXME: build agent card from agent's capabilities from intent
    return {
      name: 'ComCom Agent',
      description: 'An agent that can answer questions about ComCom using notion.',
      url: 'http://localhost:3100/a2a',
      version: '0.0.2', // Incremented version
      capabilities: {
        streaming: true, // The new framework supports streaming
        pushNotifications: false, // Assuming not implemented for this agent yet
        stateTransitionHistory: true, // Agent uses history
      },
      // authentication: null, // Property 'authentication' does not exist on type 'AgentCard'.
      defaultInputModes: ['text'],
      defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
      skills: [],
      supportsAuthenticatedExtendedCard: false,
    }
  }

  public async addMCPModule(mcp: MCPClient): Promise<void> {
    this.mcp = mcp;
  }

  public async handleQuery(query: string): Promise<any> {
    // TODO
    // 1. Get intent prompt for MCP tools
    // 2. Check if the query can be handled by own tool
    //    - If yes, use the tool to handle the query
    //    - If no, go to the next step 
    // 3. Search the Agent Gallery to see if there is an agent capable of handling the query
    //    - If yes, request the agent to perform the task for handling the query
    //    - If no, go to the next step
    // 4. Return the default inference result
    let intentPromptResult = ''

    if (this.mcp) {
      const { response } = await this.mcp.processQuery(query);
      intentPromptResult += `
      ${response}
      `;
    }

    const response = await this.model.fetch(query, intentPromptResult);

    return response;
  };
}