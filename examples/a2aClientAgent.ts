import "dotenv/config";

import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { A2AModule } from "../src/intent/modules/a2a/index.js";
import AzureOpenAI from "../src/models/openai.js";
import { AINAgentInfo } from "../src/types/index.js";

async function main() {
	const model = new AzureOpenAI(
		process.env.AZURE_OPENAI_PTU_BASE_URL!,
		process.env.AZURE_OPENAI_PTU_API_KEY!,
		process.env.AZURE_OPENAI_PTU_API_VERSION!,
		process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
	);
	const intentAnalyzer = new IntentAnalyzer(model);
	const a2aModule = new A2AModule();

	await a2aModule.addA2AServer("http://localhost:3100");
	intentAnalyzer.addA2AModule(a2aModule);

  const info: AINAgentInfo = {
    name: "Client Agent",
    description: "A client agent for test",
    version: "0.0.3", // Incremented version
  };

	const agent = new AINAgent(intentAnalyzer, info);

	agent.start(Number(process.env.PORT) || 5050);
}

main();
