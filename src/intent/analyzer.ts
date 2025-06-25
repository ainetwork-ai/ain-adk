import type { BaseModel } from "@/models/base.js";
import { loggers } from "@/utils/logger.js";
import type { A2AModule } from "./modules/a2a/index.js";
import type { A2ATool } from "./modules/a2a/tool.js";
import type { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import type { FOLClient } from "./modules/fol/index.js";
import type { MCPModule } from "./modules/mcp/index.js";
import type { MCPTool } from "./modules/mcp/tool.js";

export class IntentAnalyzer {
	private model: BaseModel;
	private a2a?: A2AModule;
	private mcp?: MCPModule;
	private fol?: FOLClient;
	private basePrompt?: string;

	constructor(model: BaseModel) {
		this.model = model;
	}

	public addMCPModule(mcp: MCPModule): void {
		this.mcp = mcp;
	}

	public addA2AModule(a2a: A2AModule): void {
		this.a2a = a2a;
	}

	public addFOLModule(fol: FOLClient): void {
		this.fol = fol;
	}

	public addBasePrompt(prompt: string): void {
		this.basePrompt = prompt;
	}

	public async handleQuery(query: string): Promise<any> {
		const threadId = "aaaa-bbbb-cccc-dddd"; // FIXME
		// 1. intent triggering
		// TODO: Extract the user's intent using query, context, and FOL
		const intent = query; // FIXME

		// 2. intent fulfillment
		// Using the extracted intent, generate a response.
		const response = (await this.generate(intent, threadId)).response;

		return response;
	}

	public async generate(query: string, threadId: string) {
		// FIXME(yoojin): Need general system prompt for MCP tool search
		const systemMessage = `
${this.basePrompt}

유저의 질문에 대해 function 을 사용할 수 있다.

function에는 MCP_Tool, A2A_Tool 두 가지 <tool_type> 이 존재한다.
tool type은 function 결과 메세지의 처음에 [Bot Called <tool_type> with args <tool_args>] 이 포함됨을 통해 알 수 있다.
각 <tool_type> 에 대한 사용 지침은 아래를 참고한다.

<MCP_Tool>
    ${
			// FIXME: Need mcp specified prompt.
			""
		}
    function 사용에 실패하면 더이상 function을 호출하지 않고 답변을 생성한다.
</MCP_Tool>

<A2A_Tool>
    A2A_Tool은 나와 다른 정보를 가진 Agent에게 query를 보내고 답변을 받는 function이다.
    A2A_Tool을 통한 결과는 요청한 Agent에서 충분이 숙고한 후 생성한 텍스트로, 해당 내용에 대해서는 더 이상 발전시킬 수 없는 완성된 결과물이다.
    이에 대해 같은 질문으로 내용을 보충하거나 새로운 function을 사용하지 않아도 된다.
</A2A_Tool>
`;

		const messages = [
			{ role: "system", content: systemMessage.trim() },
			{ role: "user", content: query },
		];

		const tools: AgentTool[] = [];

		if (this.mcp) {
			tools.push(...this.mcp.getTools());
		}
		if (this.a2a) {
			tools.push(...(await this.a2a.getTools()));
		}

		const processList: string[] = [];
		let finalMessage = "";
		let didCallTool = false;

		while (true) {
			const response = await this.model.fetchWithContextMessage(
				messages,
				tools,
			);
			didCallTool = false;

			loggers.intent.debug("messages", { messages });

			// TODO: content, tool_calls formatting
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
							`[Bot Called MCP Tool ${toolName} with args ${JSON.stringify(toolArgs)}]\n` +
							JSON.stringify(result.content, null, 2);
					} else if (this.a2a && selectedTool.protocol === PROTOCOL_TYPE.A2A) {
						const result = await this.a2a.useTool(
							selectedTool as A2ATool,
							messagePayload!,
							threadId,
						);
						toolResult = `[Bot Called A2A Tool ${toolName}]\n${result.join("\n")}`;
					} else {
						// Unrecognized tool type. It cannot be happened...
						loggers.intent.warn(
							`Unrecognized tool type: ${selectedTool.protocol}`,
						);
						continue;
					}

					loggers.intent.debug("toolResult", { toolResult });

					processList.push(toolResult);
					messages.push({
						role: "user",
						content: toolResult,
					});
				}
			} else if (content) {
				processList.push(content);
				finalMessage = response;
			}

			if (!didCallTool) break;
		}

		const botResponse = {
			process: processList.join("\n"),
			response: finalMessage,
		};

		return botResponse;
	}
}
