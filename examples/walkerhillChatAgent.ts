// @ts-nocheck
import "../src/zod-polyfill.js";  // <-- 폴리필 적용
import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPModule } from "../src/intent/modules/mcp/index.js";
import AzureOpenAI from "../src/models/openai.js";
import GeminiModel from "../src/models/gemini.js";
import { AINAgentInfo } from "../src/types/index.js";

/*
const model = new AzureOpenAI(
	process.env.AZURE_OPENAI_PTU_BASE_URL!,
	process.env.AZURE_OPENAI_PTU_API_KEY!,
	process.env.AZURE_OPENAI_PTU_API_VERSION!,
	process.env.AZURE_OPENAI_MODEL_NAME!,
);
*/

const walkerhillAgentBasePrompt = `
당신은 워커힐 AI 가이드 채팅 내역을 분석하고, 사용자의 질문에 답변하는 역할을 합니다.
당신의 주요 임무는 다음과 같습니다:

인텐트 집계
사용자가 요청한 기간(예: ‘6월’, ‘5월’) 동안 채팅에서 트리거된 각 인텐트의 발생 빈도를 집계합니다.
결과를 표 형태로 제공하거나, 필요 시 차트로 시각화할 수 있습니다.

기간 해석
“지난달”, “6월달” 같은 표현을 만나면, 이를 시스템 시간(Asia/Seoul 기준)과 대응하여 정확한 날짜 범위(예: 2025년 6월 1일 ~ 6월 30일)로 변환합니다.
연도는 2025년으로 고정하고, 월은 사용자가 요청한 월로 설정합니다.

차트 생성
사용자가 “chart plot을 그려줘”라고 요청하면, 판다스(DataFrame)를 이용해 집계 데이터를 준비한 뒤, matplotlib으로 막대 그래프나 선 그래프를 생성합니다.
생성된 차트는 이미지 형태로 응답합니다.

질의 처리
사용자가 인텐트 집계만 요청할 경우, “인텐트별 발생 빈도” 표를 먼저 보여줍니다.
차트까지 요청할 경우, 표와 함께 차트 이미지도 함께 제공합니다.
추가적인 세부 질의(예: 특정 인텐트 상세 분류, 상위 N개 인텐트 등)에도 대응합니다.

출력 형식
표: Markdown 표로 제공
차트: “다음은 <기간> 인텐트 트리거링 빈도 차트입니다.”라는 설명과 함께 이미지 삽입
날짜는 YYYY년 M월 D일 형식으로 명시

예시
“6월달 채팅에서 가장 많이 트리거링 된 인텐트는 뭐야?” → “2025년 6월 1일~6월 30일 기준, 가장 많이 트리거된 인텐트는 ‘체크인 문의’로 총 1,245회입니다.”
“5월달 채팅에서 트리거링된 인텐트에 대한 chart plot을 그려줘” → 집계 표 + 차트 이미지

위의 지침을 항상 준수하며, 사용자가 명확한 응답을 받을 수 있도록 채팅 내역을 정확하고 친절하게 분석·제공하세요.
`

const model = new GeminiModel(
	process.env.GEMINI_API_KEY!,
	process.env.GEMINI_MODEL_NAME!,
);
const intentAnalyzer = new IntentAnalyzer(model);
intentAnalyzer.addBasePrompt(walkerhillAgentBasePrompt);
const mcp = new MCPModule();

await mcp.addMCPConfig({
	walkerhillChatApi: {
		command: "npx",
		args: ["ts-node", "./examples/walkerhillChatMCPServer.ts"],
		env: {
			...getDefaultEnvironment(),
               EXPORT_API_URL: process.env.EXPORT_API_URL!,
               EXPORT_API_KEY: process.env.EXPORT_API_KEY!,
		},
	},
});

intentAnalyzer.addMCPModule(mcp);

const info: AINAgentInfo = {
  name: "Walkerhill AI Guide Agent",
  description: "An agent that can provide answers by referencing the contents of Walkerhill AI Guide.",
  version: "0.0.1", // Incremented version
};
const agent = new AINAgent(
  intentAnalyzer,
  info,
  "http://localhost:3101"
);

agent.app.post("/analysis", async (req, res) => {
  const { message } = req.body;
  if (typeof message !== "string") {
    return res.status(400).json({ error: "message 필드에 자연어 문자열을 넣어주세요." });
  }

  // “6월달 채팅 내역 줘” 같은 요청이 들어오면,
  // intentAnalyzer 에 이미 설정한 basePrompt 대로 MCP tool(exportChats)을 호출합니다.
  try {
    const botResponse = await intentAnalyzer.handleQuery(message);
    // handleQuery 의 반환값 형태에 맞춰 응답
    res.json(botResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


agent.start(Number(process.env.PORT) || 3101);
