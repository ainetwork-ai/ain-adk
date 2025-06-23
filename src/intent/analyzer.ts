
import type { BaseModel } from "@/models/base.js";
import { loggers } from "@/utils/logger.js";
import type { A2AModule } from "./modules/a2a/index.js";
import type { A2ATool } from "./modules/a2a/tool.js";
import type { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import type { MCPModule } from "./modules/mcp/index.js";
import type { MCPTool } from "./modules/mcp/tool.js";

export interface Chat {
	user: string;
	assistant?: string;
}

export class IntentAnalyzer {
	private model: BaseModel;
	private a2a?: A2AModule;
	private mcp?: MCPModule;
  private fol?: Client;

	constructor(model: BaseModel) {
		this.model = model;
	}

	public addMCPModule(mcp: MCPModule): void {
		this.mcp = mcp;
	}

	public addA2AModule(a2a: A2AModule): void {
		this.a2a = a2a;
	}

	public async classifyIntent(query: string, history: Chat[]): Promise<string> {
		// TODO(haechan): Implement more sophisticated intent classification logic
		// 1. db연결해서 intent trigger sentence 가져오기
		// 2. vector search 또는 LLM 사용해서 intent 찾기
		// 3. 찾은 intent 반환
		// db에 쓰는 건 어디에? adk안에 구현?
		// if) agent space에서 쓰는 db(관리자용)를 하나로 정한다. (ex. mongo, postgres, etc)
		// agent init할때 url 받아서 연결.
		// 다른 router(ex. POST /intent/sentence)에서 this.db를 주입받아서 쓴다?
		// 이 classifyIntent도 db 주입받아서 쓴다? -> 이건 unit test가 힘들어져서 history받아서 쓰는게 맞는듯
		if (query) {
			if (query.includes("hello")) {
				// just an example
				return "hello";
			}
			if (query.includes("notion")) {
				// just an example
				return "notion";
			}
		}
		return "unknown";
	}

  public addFOLModule(fol: FOLClient): void {
    this.fol = fol;
  }

	public async handleQuery(query: string): Promise<any> {
		const threadId = "aaaa-bbbb-cccc-dddd"; // FIXME
		// 1. intent triggering
		// TODO: Extract the user's intent using query, context, and FOL
		const intent = await this.classifyIntent(query, []); // FIXME
		// fulfillmentInfo = await this.getFulfillmentInfo(intent)???
		// fulfillmentInfo.prompt, fulfillmentInfo.tools, fulfillmentInfo.a2a ...

		// 2. intent fulfillment
		// Using the extracted intent, generate a prompt for inference
		const prompt = (await this.generatePrompt(query, threadId)).response;

		// 3. Generate response using prompt
		const response = await this.model.fetch(query, prompt);

		return response;
	}

	public async generatePrompt(query: string, threadId: string) {
		// FIXME(yoojin): Need general system prompt for MCP tool search
		const systemMessage =
			"tool 사용에 실패하면 더이상 function을 호출하지 않는다.";

		const messages = [
			{ role: "system", content: systemMessage.trim() },
			{ role: "user", content: query },
		];

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
				tools,
			);
			didCallTool = false;

			loggers.intent.debug("messages", { messages });

			const { content, tool_calls } = response;

			loggers.intent.debug("content", { content });
			loggers.intent.debug("tool_calls", { ...tool_calls });

			if (tool_calls) {
				const messagePayload = this.a2a?.getMessagePayload(query, threadId);

				for (const tool of tool_calls) {
					const calledFunction = tool.function;
					const toolName = calledFunction.name;
					didCallTool = true;
					const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

					let toolResult = "";
					if (this.mcp && selectedTool.protocol === PROTOCOL_TYPE.MCP) {
						const toolArgs = JSON.parse(calledFunction.arguments) as
							| { [x: string]: unknown }
							| undefined;
						loggers.intent.debug("MCP tool call", { toolName, toolArgs });
						const result = await this.mcp.useTool(
							selectedTool as MCPTool,
							toolArgs,
						);
						toolResult =
							`[Bot Called Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
							JSON.stringify(result.content, null, 2);
					} else if (this.a2a && selectedTool.protocol === PROTOCOL_TYPE.A2A) {
						const result = await this.a2a.useTool(
							selectedTool as A2ATool,
							messagePayload!,
							threadId,
						);
						toolResult = `[Bot Called Tool ${toolName}]\n${result.join("\n")}`;
					} else {
						// Unrecognized tool type. It cannot be happened...
						loggers.intent.warn(
							`Unrecognized tool type: ${selectedTool.protocol}`,
						);
						continue;
					}

					loggers.intent.debug("toolResult", { toolResult });

					finalText.push(toolResult);
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
