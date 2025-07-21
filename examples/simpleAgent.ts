import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AzureOpenAI } from "../src/modules/models/openai.js";
import { GeminiModel } from "../src/modules/models/gemini.js";
import { MCPModule, MemoryModule, ModelModule } from "../src/modules/index.js";
import { InMemoryMemory } from "../src/modules/memory/inmemory.js";
import { AinAgentManifest } from "../src/types/index.js";
import { AINAgent } from "../src/app.js";

const PORT = Number(process.env.PORT) || 9100;

const modelModule = new ModelModule();
const model = new AzureOpenAI(
	process.env.AZURE_OPENAI_PTU_BASE_URL!,
	process.env.AZURE_OPENAI_PTU_API_KEY!,
	process.env.AZURE_OPENAI_PTU_API_VERSION!,
	process.env.AZURE_OPENAI_MODEL_NAME!,
);
modelModule.addModel('azure-gpt-4o', model);
/*
const model = new GeminiModel(
	process.env.GEMINI_API_KEY!,
	process.env.GEMINI_MODEL_NAME!,
);
*/
const mcpModule = new MCPModule();
await mcpModule.addMCPConfig({
	notionApi: {
		command: "npx",
		args: ["-y", "@notionhq/notion-mcp-server"],
		env: {
			...getDefaultEnvironment(),
			OPENAPI_MCP_HEADERS: `{\"Authorization\": \"Bearer ntn_${process.env.NOTION_API_KEY}\", \"Notion-Version\": \"2022-06-28\" }`,
		},
	},
});

const inMemoryMemory = new InMemoryMemory("");
const memoryModule = new MemoryModule(inMemoryMemory);

const manifest: AinAgentManifest = {
  name: "ComCom Agent",
  description: "An agent that can provide answers by referencing the contents of ComCom Notion.",
  version: "0.0.2", // Incremented version
	url: `http://localhost:${PORT}`
};
const agent = new AINAgent(
  manifest,
	{ modelModule, mcpModule, memoryModule }
);

agent.start(PORT);
