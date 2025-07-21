import "dotenv/config";

import AINAgent from "../src/app.js";
import { AinAgentManifest } from "../src/types/index.js";
import AzureOpenAI from "../src/modules/models/openai.js";
import { A2AModule, ModelModule } from "../src/modules/index.js";

async function main() {
  const modelModule = new ModelModule();
	const model = new AzureOpenAI(
		process.env.AZURE_OPENAI_PTU_BASE_URL!,
		process.env.AZURE_OPENAI_PTU_API_KEY!,
		process.env.AZURE_OPENAI_PTU_API_VERSION!,
		process.env.AZURE_OPENAI_MODEL_NAME!,
	);
  modelModule.addModel('azure-gpt-4o', model);

	const a2aModule = new A2AModule();
	await a2aModule.addA2APeerServer("http://localhost:9100");

  const manifest: AinAgentManifest = {
    name: "Client Agent",
    description: "A client agent for test",
    version: "0.0.3", // Incremented version
  };

	const agent = new AINAgent(
    manifest,
    { modelModule, a2aModule }
  );

	agent.start(Number(process.env.PORT) || 3100);
}

main();