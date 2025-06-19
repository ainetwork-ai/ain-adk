import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import dotenv from 'dotenv';
import { BaseModel } from "@/models/base.js";
import { MCPConfig } from '@/types/mcp.js';
import { MCPTool } from './mcpTool.js';
dotenv.config();

export class MCPClient {
  private mcpMap: Map<string, Client>;
  private model: BaseModel;
  private transportMap: Map<string, StdioClientTransport> = new Map();
  private tools: MCPTool[] = [];

  constructor(model: BaseModel) {
    this.model = model;
    this.mcpMap = new Map();
  }

  async addMCPConfig(mcpConfig: MCPConfig) {
    try {
      for (const [name, conf] of Object.entries(mcpConfig)) {
        // FIXME(yoojin): Need strict duplication check.
        if (this.mcpMap.get(name) && this.transportMap.get(name)) continue; // Duplicated mcp: skip

        this.transportMap.set(name, new StdioClientTransport(conf));
        const mcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
        await mcp.connect(this.transportMap.get(name)!);
        this.mcpMap.set(name, mcp);

        const toolsResult = await mcp.listTools();
        this.tools.push(...toolsResult.tools.map(tool => {
          return new MCPTool(name, tool);
        }));
      }
      console.log(
        'Connected to server with tools:',
        this.tools.map((tool) => tool.id)
      );
    } catch (e) {
      console.log('Failed to connect to MCP server: ', e);
      throw e;
    }
  }

  async processQuery(userMessage: string) {
    // FIXME(yoojin): Need general system prompt for MCP tool search
    const systemMessage = `tool 사용에 실패하면 더이상 function을 호출하지 않는다.`;

    const messages = [
      { role: "system", content: systemMessage.trim() },
      { role: "user", content: userMessage },
    ]

    const finalText: string[] = [];
    let didCallTool = false;

    while (true) {
      const response = await this.model.fetchWithContextMessage(
        messages,
        this.tools
      );
      didCallTool = false;
      
      const { content, tool_calls } = response;

      console.log('mcpContent:>> ', content);
      console.log('mcpToolCalls:>> ', tool_calls);

      if (tool_calls) {
        for (const tool of tool_calls) {
          const calledFunction = tool.function;
          didCallTool = true;
          const toolName = calledFunction.name;
          const toolArgs = JSON.parse(calledFunction.arguments) as
            | { [x: string]: unknown }
            | undefined;
  
          console.log('mcpTool:>> ', toolName, toolArgs);
          const { serverName: mcpName, mcpTool } = this.tools.filter(
            tool => tool.id === toolName
          )[0];

          // 실제 툴 호출
          const result = await this.mcpMap.get(mcpName)!.callTool({
            name: mcpTool.name,
            arguments: toolArgs,
          });
  
          const toolResult =
            `[Bot Called Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
            JSON.stringify(result.content, null, 2);
  
          console.log('mcpToolResult :>> ', toolResult);
  
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

  getTools() {
    return this.tools;
  }

  async useTool(tool: MCPTool, _args?: any): Promise<any> {
    const { serverName, mcpTool } = tool;
    const toolName = mcpTool.name
    const mcp = this.mcpMap.get(serverName);

    if (!mcp) {
      throw new Error(`Invalid MCP Tool ${serverName}-${mcpTool.name}`)
    }

    const result = await mcp.callTool({
      name: toolName,
      arguments: _args,
    });
    const toolResult =
      `[Bot Called Tool ${toolName} with args ${JSON.stringify(_args)}]\n` +
      JSON.stringify(result.content, null, 2);
  
    console.log('toolResult :>> ', toolResult);
    return result;
  }

  async cleanup() {
    this.mcpMap.forEach((mcp: Client) => {
      mcp.close();
    });
  }
}
