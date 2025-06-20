import { BaseModel } from "@/models/base.js";
import { AgentCard } from "@a2a-js/sdk";

import { MCPClient } from "./modules/mcp/mcpClient.js";
import { A2AModule } from "./modules/a2a/a2a.js";
import { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import { MCPTool } from "./modules/mcp/mcpTool.js";
import { A2ATool } from "./modules/a2a/a2aTool.js";
import { loggers } from "@/utils/logger.js";

export class IntentAnalyzer {
  private model: BaseModel;
  private a2a?: A2AModule;
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

  public addMCPModule(mcp: MCPClient): void {
    this.mcp = mcp;
  }

  public addA2AModule(a2a: A2AModule): void {
    this.a2a = a2a;
  }

  public async handleQuery(query: string): Promise<any> {
    const threadId = "aaaa-bbbb-cccc-dddd";   // FIXME
    // 1. intent triggering
    // TODO: Extract the user's intent using query, context, and FOL
    const intent = query;   // FIXME

    // 2. intent fulfillment
    // Using the extracted intent, generate a prompt for inference
    const prompt = (await this.generatePrompt(intent, threadId)).response;

    // 3. Generate response using prompt
    const response = await this.model.fetch(query, prompt);

    return response;
  };

  public async generatePrompt(query: string, threadId: string) {
    // FIXME(yoojin): Need general system prompt for MCP tool search
    const systemMessage = `tool 사용에 실패하면 더이상 function을 호출하지 않는다.`;

    const messages = [
      { role: "system", content: systemMessage.trim() },
      { role: "user", content: query },
    ]

    const tools: AgentTool[] = [];
    
    if (this.mcp) {
      tools.push(...this.mcp.getTools());
    }
    if (this.a2a) {
      tools.push(...this.a2a.getTools());
    }

    const finalText: string[] = [];
    let didCallTool = false;

    while (true) {
      const response = await this.model.fetchWithContextMessage(
        messages,
        tools
      );
      didCallTool = false;
      
      loggers.intent.debug('messages:', messages);
      loggers.intent.debug('response:', JSON.stringify(response));

      const { content, tool_calls } = response;

      loggers.intent.debug('content:', content);
      loggers.intent.debug('tool_calls:', tool_calls);

      if (tool_calls) {
        const messagePayload = this.a2a && this.a2a.getMessagePayload(query, threadId);

        for (const tool of tool_calls) {
          const calledFunction = tool.function;
          const toolName = calledFunction.name;
          didCallTool = true;
          const selectedTool = tools.filter(
            tool => tool.id === toolName
          )[0];

          let toolResult: string = '';
          if (selectedTool.protocol === PROTOCOL_TYPE.MCP) {
            const toolArgs = JSON.parse(calledFunction.arguments) as
              | { [x: string]: unknown }
              | undefined;
            loggers.intent.debug('MCP tool call:', { toolName, toolArgs });
            const result = await this.mcp!.useTool(selectedTool as MCPTool, toolArgs);
            toolResult =
              `[Bot Called Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
              JSON.stringify(result.content, null, 2);
          } else if (selectedTool.protocol === PROTOCOL_TYPE.A2A) {
            const result = await this.a2a!.useTool(
              selectedTool as A2ATool, messagePayload!, threadId
            );
            toolResult = `[Bot Called Tool ${toolName}]\n` + result.join('\n');
          } else {
            // Unrecognized tool type. It cannot be happened...
            console.warn(`Unrecognized tool type: ${selectedTool.protocol}`);
            continue;
          }

          loggers.intent.debug('toolResult :>> ', toolResult);

          finalText.push(toolResult);
          messages.push({
            role: 'user',
            content: toolResult,
          });
        }
      }
      else if (content) {
        finalText.push(content);
      }

      if (!didCallTool) break;
    }

    const botResponse = {
      process: finalText.join('\n'),
      response: finalText[finalText.length - 1],
    };

    return botResponse;
  }
}