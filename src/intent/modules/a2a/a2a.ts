import { BaseModel } from "@/models/base.js";
import { A2AClient, AgentCard, Message, MessageSendParams, Task, TaskStatusUpdateEvent, TextPart } from "@a2a-js/sdk";
import { A2ATool } from "./a2aTool.js";
import { ChatCompletionMessage } from "openai/resources";
import { randomUUID } from "node:crypto";

interface A2AThread {
  taskId: string | undefined;
  contextId: string | undefined;
}
export class A2AModule {
  private model: BaseModel;
  private a2aServers: Map<string, A2ATool> = new Map();
  private threads: Map<string, A2AThread> = new Map();

  constructor(model: BaseModel) {
    this.model = model;
  }

  public async addA2AServer(url: string): Promise<void> {
    try {
      const client = new A2AClient(url);
      const card: AgentCard = await client.getAgentCard();
      const toolName = card.name.replace(' ', '-');
      const a2aTool = new A2ATool(toolName, client);

      this.a2aServers.set(toolName, a2aTool);
    } catch (error: any) {
      console.error("Error fetching or parsing agent card");
      throw error;
    }
  }

  public getTools(): A2ATool[] {
    return Array.from(this.a2aServers.values()) ;  
  }

  public getMessagePayload(query: string, threadId: string): Message {
    const messagePayload: Message = {
      messageId: randomUUID(),
      kind: "message",
      role: "user",   // FIXME: it could be 'agent'
      parts: [
        {
          kind: "text",
          text: query,
        }
      ]
    };

    if (!this.threads.has(threadId)) {
      this.threads.set(threadId, { taskId: undefined, contextId: undefined });
    }

    const thread = this.threads.get(threadId)!;
    if (thread.taskId) {
      messagePayload.taskId = thread.taskId;
    }
    if (thread.contextId) {
      messagePayload.contextId = thread.contextId;
    }

    return messagePayload;
  }

  public async useTool(
    tool: A2ATool, messagePayload: Message, threadId: string
  ): Promise<string[]> {
    const finalText: string[] = [];
    const client = tool.client;
    const params: MessageSendParams = {
      message: messagePayload
    }
    const thread = this.threads.get(threadId)!;

    try {
      const stream = client.sendMessageStream(params);
      for await (const event of stream) {
        if (event.kind === "status-update") {
          const typedEvent = event as TaskStatusUpdateEvent;
          if (typedEvent.final && typedEvent.status.state !== "input-required") {
            thread.taskId = undefined;
          }
          // TODO: handle 'file', 'data' parts
          const texts = typedEvent.status.message?.parts
            .filter(part => part.kind === 'text')
            .map((part: TextPart) => part.text).join('\n');
          if (texts) {
            finalText.push(texts);
          }
        } else if (event.kind === "message") {
          // FIXME: handling text in 'message'?
          const msg = event as Message;
          if (msg.taskId && msg.taskId !== thread.taskId) {
            thread.taskId = msg.taskId;
          }
          if (msg.contextId && msg.contextId !== thread.contextId) {
            thread.contextId = msg.contextId;
          }
        } else if (event.kind === "task") {
          // FIXME: handling text in 'task'?
          const task = event as Task;
          if (task.id !== thread.taskId) {
            thread.taskId = task.id;
          }
          if (task.contextId && task.contextId !== thread.contextId) {
            thread.contextId = task.contextId;
          }
        } else {
          console.warn("Received unknown event structure from stream: ", event);
        }
      }
    } catch (error: any) {
      console.error("Error communicating with agent: ", error.message || error);
    }

    return finalText;
  }

  async processQuery(userMessage: string, threadId: string) {
    // TODO: add system message
    const messages = [
      { role: "user", content: userMessage }
    ];
    const finalText: string[] = [];

    const tools = Array.from(this.a2aServers.values());
    const response: ChatCompletionMessage = await this.model.fetchWithContextMessage(
      messages,
      tools
    );

    const { content, tool_calls } = response;

    console.log('a2aContent:>> ', content);
    console.log('a2aToolCalls:>> ', tool_calls);
    if (tool_calls) {
      const messagePayload = this.getMessagePayload(userMessage, threadId);

      for (const tool of tool_calls) {
        const a2aTool = this.a2aServers.get(tool.function.name);
        if (!a2aTool) {
          continue;
        }

        const texts = await this.useTool(a2aTool, messagePayload, threadId);
        finalText.push(...texts);
      }
    } else if (content) {
      finalText.push(content);
    }

    const botResponse = {
      process: finalText.join('\n'),
      response: finalText[finalText.length - 1],
    };

    return botResponse;
  }
}