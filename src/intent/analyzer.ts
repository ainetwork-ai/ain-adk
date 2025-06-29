import type { IBaseModel } from "@/models/base.js";
import { loggers } from "@/utils/logger.js";
import type { A2AModule } from "./modules/a2a/index.js";
import type { A2ATool } from "./modules/a2a/tool.js";
import type { AgentTool } from "./modules/common/tool.js";
import { PROTOCOL_TYPE } from "./modules/common/types.js";
import type { FOLClient } from "./modules/fol/index.js";
import type { MCPModule } from "./modules/mcp/index.js";
import type { MCPTool } from "./modules/mcp/tool.js";

export interface Chat {
	user: string;
	assistant?: string;
}

export interface Intent {
	name: string;
	description: string;
	triggerSentences: string[];
}

export class IntentAnalyzer {
	private model: IBaseModel;
	private a2a?: A2AModule;
	private mcp?: MCPModule;
	private fol?: FOLClient;
	private intents: Intent[];
	private basePrompt?: string;

	constructor(model: IBaseModel, intents: Intent[]) {
		this.model = model;
		this.intents = intents;
	}

	public addMCPModule(mcp: MCPModule): void {
		this.mcp = mcp;
	}

	public addA2AModule(a2a: A2AModule): void {
		this.a2a = a2a;
	}

	private async inferenceIntentName(query: string): Promise<string> {
		const result = await this.model.fetchWithContextMessage(
			[
				{
					role: "system",
					content: `
				당신은 인텐트 분류기이다. 주어진 인텐트 설명에 따라 유저 쿼리에 대해 적절한 인텐트 선택하여 반환해야한다.
				반환가능한 인텐트 리스트와 설명은 다음과 같다. 
				${this.intents
					.map(
						(intent) =>
							`
						name: ${intent.description}
						desc: ${intent.description}
						triggerSentences: ${intent.triggerSentences.map((sentence) => `- ${sentence}`).join("\n")}`,
					)
					.join("\n")}
				
				반드시 주어진 "인텐트 이름" 만 반환해야한다.
				예: 
				query: "오늘 날씨 어때?"
				response: "find_weather"
				`,
				},
				{ role: "user", content: `${query}\n\n` },
			],
			[],
		);
		const intentName = result.content;
		if (!intentName) {
			throw new Error("Intent not found");
		}
		return intentName;
	}

	public async classifyIntent(query: string, history: Chat[]): Promise<string> {
		return this.inferenceIntentName(query);
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
		const intentName = await this.classifyIntent(query, []); // FIXME
		// fulfillmentInfo = await this.getFulfillmentInfo(intent)???
		// fulfillmentInfo.prompt, fulfillmentInfo.tools, fulfillmentInfo.a2a ...

		// 2. intent fulfillment
		// Using the extracted intent, generate a response.
		const response = (await this.generate(query, threadId)).response;

		return response;
	}

	public async generate(query: string, threadId: string) {
		// FIXME(yoojin): Need general system prompt for MCP tool search
		const systemMessage = `
${this.basePrompt}

유저의 질문에 대해 tool 을 사용할 수 있다.

tool에는 MCP_Tool, A2A_Tool 두 가지 <tool_type> 이 존재한다.
tool type은 tool 결과 메세지의 처음에 [Bot Called <tool_type> with args <tool_args>] 이 포함됨을 통해 알 수 있다.
tool 실행 후에는 반드시 최종 응답 메시지를 작성해야한다.

각 <tool_type> 에 대한 사용 지침은 아래를 참고한다.

<MCP_Tool>
    tools 를 통해 MCP tool 을 사용한다.
    MCP tool 의 이름은 다음과 같이 구성되어있다. 
      {MCP_NAME}_{TOOL_NAME}
      예를 들어, "notionApi" mcp의 tool 이름은 아래와 같다.
        notionApi_API-post-search

    각 MCP_NAME 마다 <{MCP_NAME}> 아래에서 별도의 규칙을 지정할 수 있다. 

    <notionApi>
      notionApi 검색에 대한 요청은 반드시 parameter 없는 API-post-search을 선행하여 키워드와 관련된 post 혹은 database_id를 찾고, 그에 따른 검색을 재수행하여 정보를 얻어야한다.
      만약 키워드로 post-search에 실패한 경우 영어 또는 한글 로 키워드를 번역하여 한 번 더 검색하고, 그럼에도 실패한 경우에 찾을수 없다는 메세지를 보내야한다.
      notionApi tool을 이용한 답변 앞에는 성공 여부와 관계없이 반드시 [notion] 을 붙인다.
    </notionApi>
</MCP_Tool>

<A2A_Tool>
    A2A_Tool은 나와 다른 정보를 가진 Agent에게 query를 보내고 답변을 받는 tool이다. 어떤 Agent 를 통해 답변 받았는지 반드시 표기해야한다.
    A2A_Tool을 통한 결과는 요청한 Agent에서 충분이 숙고한 후 생성한 텍스트로, 해당 내용에 대해서는 더 이상 발전시킬 수 없는 완성된 결과물이다.
    이에 대해 같은 질문으로 내용을 보충하거나 새로운 tool을 사용하지 않아도 된다.

    [A2A Call by <AGENT_NAME>] 으로 시작하는 텍스트가 요청으로 들어온 경우 다른 Agent에서 A2A_Tool 로써 요청한 query이다.
    이 경우 다른 A2A_Tool 을 사용하지 않고 MCP_Tool 만 사용하여 답변을 생성해야한다.
</A2A_Tool>
`;

		const messages = this.model.generateMessages([query], systemMessage.trim());

		const tools: AgentTool[] = [];
		if (this.mcp) {
			tools.push(...this.mcp.getTools());
		}
		if (this.a2a) {
			tools.push(...(await this.a2a.getTools()));
		}
		const functions = this.model.convertToolsToFunctions(tools);

		const processList: string[] = [];
		let finalMessage = "";
		let didCallTool = false;

		while (true) {
			const response = await this.model.fetchWithContextMessage(
				messages,
				functions,
			);
			didCallTool = false;

			loggers.intent.debug("messages", { messages });

			const { content, toolCalls } = response;

			loggers.intent.debug("content", { content });
			loggers.intent.debug("tool_calls", { ...toolCalls });

			if (toolCalls) {
				const messagePayload = this.a2a?.getMessagePayload(query, threadId);

				for (const toolCall of toolCalls) {
					const toolName = toolCall.name;
					didCallTool = true;
					const selectedTool = tools.filter((tool) => tool.id === toolName)[0];

					let toolResult = "";
					if (this.mcp && selectedTool.protocol === PROTOCOL_TYPE.MCP) {
						const toolArgs = toolCall.arguments as
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
					this.model.expandMessages(messages, toolResult);
				}
			} else if (content) {
				processList.push(content);
				finalMessage = content;
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
