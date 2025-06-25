import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPModule } from "../src/intent/modules/mcp/index.js";
import AzureOpenAI from "../src/models/openai.js";
import { AINAgentInfo } from "../src/types/index.js";

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  ""
);
const intentAnalyzer = new IntentAnalyzer(model);
const mcp = new MCPModule();

await mcp.addMCPConfig({
  googleSearch: {
    command: "npx",
    args: ["-y", "@adenot/mcp-google-search"],
    env: {
      ...getDefaultEnvironment(),
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID!,
    },
  },
});

intentAnalyzer.addMCPModule(mcp);

const info: AINAgentInfo = {
  name: "Google Search Agent",
  description:
    "An agent that can provide answers by referencing the contents of Google Search.",
  version: "0.0.1", // Incremented version
};
const agent = new AINAgent(intentAnalyzer, info, "http://localhost:3100");

agent.start(Number(process.env.PORT) || 3100);

// curl -X POST -H "Content-Type: application/json"  -d '{"message": "이란 이스라엘 전쟁 끝났어?"}' http://localhost:3100/query
