import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { A2AModule } from "../src/intent/modules/a2a/a2a.js";

async function main() {
  const model = new AzureOpenAI(
    process.env.AZURE_OPENAI_PTU_BASE_URL!,
    process.env.AZURE_OPENAI_PTU_API_KEY!,
    process.env.AZURE_OPENAI_PTU_API_VERSION!,
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    ""
  );
  const intentAnalyzer = new IntentAnalyzer(model);
  const a2aModule = new A2AModule(model);

  await a2aModule.addA2AServer("http://localhost:3100");
  intentAnalyzer.addA2AModule(a2aModule);

  const agent = new AINAgent(intentAnalyzer, true);

  agent.start(Number(process.env.PORT) || 5050);
}

main();