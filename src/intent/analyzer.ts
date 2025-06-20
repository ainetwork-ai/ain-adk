import { BaseModel } from "@/models/base.js";
import { AgentCard } from "@a2a-js/sdk";

import { MCPClient } from "./modules/mcp/mcpClient.js";
import { A2AModule } from "./modules/a2a/a2a.js";
import { FOLClient } from "./modules/fol/folClient.js";
import { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import { MCPTool } from "./modules/mcp/mcpTool.js";

export class IntentAnalyzer {
  private model: BaseModel;
  private a2a?: A2AModule;
  private mcp?: MCPClient;
  private fol?: FOLClient;

  constructor(model: BaseModel) {
    this.model = model;
  }

  public buildAgentCard(): AgentCard {
    // FIXME: build agent card from agent's capabilities from intent
    return {
      name: "ComCom Agent",
      description:
        "An agent that can answer questions about ComCom using notion.",
      url: "http://localhost:3100/a2a",
      version: "0.0.2", // Incremented version
      capabilities: {
        streaming: true, // The new framework supports streaming
        pushNotifications: false, // Assuming not implemented for this agent yet
        stateTransitionHistory: true, // Agent uses history
      },
      // authentication: null, // Property 'authentication' does not exist on type 'AgentCard'.
      defaultInputModes: ["text"],
      defaultOutputModes: ["text", "task-status"], // task-status is a common output mode
      skills: [],
      supportsAuthenticatedExtendedCard: false,
    };
  }

  public addMCPModule(mcp: MCPClient): void {
    this.mcp = mcp;
  }

  public addA2AModule(a2a: A2AModule): void {
    this.a2a = a2a;
  }

  public addFOLModule(fol: FOLClient): void {
    this.fol = fol;
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
    let intentPromptResult = "";

    // if (this.mcp) {
    //   const { response } = await this.mcp.processQuery(query);
    //   intentPromptResult += `
    //   ${response}
    //   `;
    // }

    intentPromptResult = (await this.generateIntent(query)).response;

    const response = await this.model.fetch(query, intentPromptResult);

    return response;
  }

  public async generateIntent(query: string) {
    // FIXME(yoojin): Need general system prompt for MCP tool search
    const systemMessage = `tool 사용에 실패하면 더이상 function을 호출하지 않는다.`;

    const messages = [
      { role: "system", content: systemMessage.trim() },
      { role: "user", content: query },
    ];

    const tools: AgentTool[] = [];

    // FIXME: Need to push a2a into tools

    if (this.mcp) {
      tools.push(...this.mcp.getTools());
    }

    const finalText: string[] = [];
    let didCallTool = false;

    while (true) {
      const response = await this.model.fetchWithContextMessage(
        messages,
        tools
      );
      didCallTool = false;

      console.log("messages: ", messages);
      console.log("response: ", JSON.stringify(response));

      const { content, tool_calls } = response;

      if (tool_calls) {
        for (const tool of tool_calls) {
          const calledFunction = tool.function;
          didCallTool = true;
          const toolName = calledFunction.name;
          const toolArgs = JSON.parse(calledFunction.arguments) as
            | { [x: string]: unknown }
            | undefined;

          console.log(toolName, toolArgs);
          const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

          let result: any;

          if (selectedTool.protocol === PROTOCOL_TYPE.MCP) {
            result = this.mcp!.useTool(selectedTool as MCPTool, toolArgs);
          }
          if (selectedTool.protocol === PROTOCOL_TYPE.A2A) {
            // FIXME: Add A2A call
          }

          const toolResult =
            `[Bot Called Tool ${toolName} with args ${JSON.stringify(
              toolArgs
            )}]\n` + JSON.stringify(result.content, null, 2);

          console.log("toolResult :>> ", toolResult);

          // 로그용 텍스트
          finalText.push(toolResult);

          // 툴 결과를 메시지로 추가
          messages.push({
            role: "user",
            content: toolResult,
          });
        }
      } else if (content) {
        finalText.push(content);
      }

      if (!didCallTool) break;
    }

    const botResponse = {
      process: finalText.join("\n"),
      response: finalText[finalText.length - 1],
    };

    return botResponse;
  }
}
