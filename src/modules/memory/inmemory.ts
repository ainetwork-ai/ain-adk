import { randomUUID } from "node:crypto";
import type { ChatObject, SessionObject } from "@/types/memory.js";
import { BaseMemory } from "./memory.module.js";

export default class InMemoryMemory extends BaseMemory {
	public agentPrompt: string;
	public sessionHistory: Map<string, SessionObject>;

	constructor(prompt: string) {
		super();
		this.agentPrompt = prompt;
		this.sessionHistory = new Map<string, SessionObject>();
	}

	public async getSessionHistory(sessionId: string): Promise<SessionObject> {
		return this.sessionHistory.get(sessionId) || {};
	}

	public async updateSessionHistory(
		sessionId: string,
		chat: ChatObject,
	): Promise<void> {
		const newChatId = randomUUID();
		const history = this.sessionHistory.get(sessionId) || {};
		history[newChatId] = chat;
		this.sessionHistory.set(sessionId, history);
	}

	public async storeQueryAndIntent(
		query: string,
		intent: string,
		sessionId: string,
	) {}

	public async getAgentPrompt(): Promise<string> {
		return this.agentPrompt;
	}

	public async updateAgentPrompt(newPrompt: string): Promise<void> {
		this.agentPrompt = newPrompt;
	}

	public async getSystemPrompt(): Promise<string> {
		const prompt = `
You are a highly sophisticated automated agent that can answer user queries by utilizing various tools and resources.

There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.
You can call tools repeatedly to take actions or gather as much context as needed until you have completed the task fully.

Don't give up unless you are sure the request cannot be fulfilled with the tools you have.
It's YOUR RESPONSIBILITY to make sure that you have done all you can to collect necessary context.

If you are not sure about content or context pertaining to the user's request, use your tools to read data and gather the relevant information: do NOT guess or make up an answer.
Be THOROUGH when gathering information. Make sure you have the FULL picture before replying. Use additional tool calls or clarifying questions as needed.

Don't try to answer the user's question directly.
First break down the user's request into smaller concepts and think about the kinds of tools and queries you need to grasp each concept.

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
</MCP_Tool>

<A2A_Tool>
    A2A_Tool은 나와 다른 정보를 가진 Agent에게 query를 보내고 답변을 받는 tool이다. 어떤 Agent 를 통해 답변 받았는지 반드시 표기해야한다.
    A2A_Tool을 통한 결과는 요청한 Agent에서 충분이 숙고한 후 생성한 텍스트로, 해당 내용에 대해서는 더 이상 발전시킬 수 없는 완성된 결과물이다.
    이에 대해 같은 질문으로 내용을 보충하거나 새로운 tool을 사용하지 않아도 된다.

    [A2A Call by <AGENT_NAME>] 으로 시작하는 텍스트가 요청으로 들어온 경우 다른 Agent에서 A2A_Tool 로써 요청한 query이다.
    이 경우 다른 A2A_Tool 을 사용하지 않고 MCP_Tool 만 사용하여 답변을 생성해야한다.
</A2A_Tool>
`;
		return prompt;
	}
}
