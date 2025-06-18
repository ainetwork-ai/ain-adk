import { BaseModel } from "@/models/base.js";
import { MCPClient } from "./modules/mcp/mcpClient.js";
import { MCPConfig } from "@/types/mcp.js";
export class IntentAnalyzer {
  private model: BaseModel;
  private mcp?: MCPClient;

  constructor(model: BaseModel) {
    this.model = model;
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