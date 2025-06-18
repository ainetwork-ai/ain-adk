import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPClient } from "../src/intent/modules/mcp/mcpClient.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  ""
);
const intentAnalyzer = new IntentAnalyzer(model);
const mcp = new MCPClient(model);

const filePath = fileURLToPath(import.meta.url);
const dir = dirname(filePath);
const mcpBuildFilePath = join(dir, "scripts", "notion-mcp-server.mjs");
await mcp.addMCPConfig({
  notionApi: {
    command: process.execPath,
    args: [mcpBuildFilePath],
    env: {
      "OPENAPI_MCP_HEADERS": `{\"Authorization\": \"Bearer ntn_${process.env.NOTION_API_KEY}\", \"Notion-Version\": \"2022-06-28\" }`
    }
  }
});

intentAnalyzer.addMCPModule(mcp);

const agent = new AINAgent(intentAnalyzer, true);

agent.start(Number(process.env.PORT) || 3100);