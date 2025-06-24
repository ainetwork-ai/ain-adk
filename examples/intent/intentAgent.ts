import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AINAgent } from "../../src/ainagent.js";
import { Intent, IntentAnalyzer } from "../../src/intent/analyzer.js";
import { MCPModule } from "../../src/intent/modules/mcp/index.js";
import AzureOpenAI from "../../src/models/openai.js";
import { AINAgentInfo } from "../../src/types/index.js";


function findAllIntentsFromDB() {
    return [
        {
            id: "1",
            name: "search_notion",
            description: "search notion",
        },
        {
            id: "2",
            name: "call_design_team",
            description: "call design team",
        },
    ];
}

function findAllIntentTriggerSentencesFromDB() {
    return [
        {
            intentId: "1",
            sentence: "노션에서 찾아줘",
        },
        {
            intentId: "1",
            sentence: "멤버들 작업목록 찾아줘",
        },
        {
            intentId: "2",
            sentence: "디자인팀 멤버들 찾아줘",
        },
        {
            intentId: "2",
            sentence: "지금 디자인팀은 뭐하고있어?",
        },
    ];
}

function getIntents() {
    // 데이터베이스에서 데이터 가져오기
    const intents = findAllIntentsFromDB();
    const intentTriggerSentences = findAllIntentTriggerSentencesFromDB();

    // adk intents interface형식으로 변환
    const mergedIntents: Intent[] = intents.map((intent) => ({
        ...intent,
        triggerSentences: intentTriggerSentences
            .filter((ts) => ts.intentId === intent.id)
            .map((ts) => ts.sentence),
    }));

    return mergedIntents;
}

const model = new AzureOpenAI(
    process.env.AZURE_OPENAI_PTU_BASE_URL!,
    process.env.AZURE_OPENAI_PTU_API_KEY!,
    process.env.AZURE_OPENAI_PTU_API_VERSION!,
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    "",
);

const intents = getIntents();

const intentAnalyzer = new IntentAnalyzer(model, intents);

const mcp = new MCPModule();

await mcp.addMCPConfig({
    notionApi: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: {
            ...getDefaultEnvironment(),
            OPENAPI_MCP_HEADERS: `{\"Authorization\": \"Bearer ntn_${process.env.NOTION_API_KEY}\", \"Notion-Version\": \"2022-06-28\" }`,
        },
    },
});

intentAnalyzer.addMCPModule(mcp);

const info: AINAgentInfo = {
    name: "ComCom Agent",
    description: "An agent that can provide answers by referencing the contents of ComCom Notion.",
    version: "0.0.2", // Incremented version
};
const agent = new AINAgent(intentAnalyzer, info, "http://localhost:3100");

agent.start(Number(process.env.PORT) || 3100);
