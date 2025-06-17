import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import dotenv from 'dotenv';
import { BaseModel } from "../models/base.js";
import { MCPTool } from "./tool.js";
dotenv.config();

/* ex)
  {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\": \"Bearer ntn_****\", \"Notion-Version\": \"2022-06-28\" }"
      }
    }
  }
 */
type MCPConfig = {
  [name: string]: StdioServerParameters,
}

export class MCPClient {
  private mcp: Client;
  private model: BaseModel;
  private transport: Map<string, StdioClientTransport> = new Map();
  private tools: MCPTool[] = [];

  constructor(model: BaseModel) {
    this.model = model;
    this.mcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
  }

  async addMCPs(mcpConfig: MCPConfig) {
    try {
      for (const [name, conf] of Object.entries(mcpConfig)) {
        this.transport.set(name, new StdioClientTransport(conf));
        const tempMcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
        tempMcp.connect(this.transport.get(name)!);
        const toolsResult = await tempMcp.listTools();
        this.tools.push(...toolsResult.tools.map(tool => {
          return new MCPTool(name, tool);
        }));
      }
      console.log(
        'Connected to server with tools:',
        this.tools.map((tool) => tool.params.name)
      );
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e);
      throw e;
    }
  }

  async processQuery(userMessage: string) {
    // FIXME(yoojin): Need general system prompt for MCP tool search
    const systemMessage = ``;

    const messages = [
      { role: "system", content: systemMessage.trim() },
      { role: "user", content: userMessage },
    ]

    const finalText: string[] = [];
    let didCallTool = false;

    while (true) {
      let response = await this.model.fetchWithContextMessage(
        messages,
        this.tools
      );
      didCallTool = false;
      
      console.log('messages: ', userMessage);
      console.log('response: ', JSON.stringify(response));

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

          // 실제 툴 호출
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });
  
          const toolResult =
            `[Bot Called Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
            JSON.stringify(result.content, null, 2);
  
          console.log('toolResult :>> ', toolResult);
  
          // 로그용 텍스트
          finalText.push(toolResult);
  
          // 툴 결과를 메시지로 추가
          messages.push({
            role: 'user',
            content: toolResult,
          });
        }
      }
      else if (content) {
        finalText.push(content);
      }

      // 더 이상 도구 호출이 없으면 종료
      if (!didCallTool) break;
    }

    const botResponse = {
      process: finalText.join('\n'),
      response: finalText[finalText.length - 1],
    };

    return botResponse;
  }

  async cleanup() {
    await this.mcp.close();
  }
}
