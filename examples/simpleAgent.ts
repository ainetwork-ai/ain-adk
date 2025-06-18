import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPClient } from "../src/intent/modules/mcp/mcpClient.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const agent = new AINAgent();
const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  ""
);
const intentAnalyzer = new IntentAnalyzer(model);
const mcp = new MCPClient(model);

await mcp.addMCPConfig({
  notionApi: {
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: {
      ...getDefaultEnvironment(),
      "OPENAPI_MCP_HEADERS": `{\"Authorization\": \"Bearer ntn_${process.env.NOTION_API_KEY}\", \"Notion-Version\": \"2022-06-28\" }`
    }
  }
});

intentAnalyzer.addMCPModule(mcp);

agent.addIntentAnalyzer(intentAnalyzer);
agent.start(Number(process.env.PORT) || 3100);