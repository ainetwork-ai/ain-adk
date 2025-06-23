import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPModule } from "../src/intent/modules/mcp/index.js";
import AzureOpenAI from "../src/models/openai.js";

const model = new AzureOpenAI(
	process.env.AZURE_OPENAI_PTU_BASE_URL!,
	process.env.AZURE_OPENAI_PTU_API_KEY!,
	process.env.AZURE_OPENAI_PTU_API_VERSION!,
	process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
	"",
);
const intentAnalyzer = new IntentAnalyzer(model);
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

const agent = new AINAgent(intentAnalyzer, true);

agent.start(Number(process.env.PORT) || 3100);
