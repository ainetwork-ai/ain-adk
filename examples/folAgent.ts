import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { FOLClient, FOLLocalStore } from "../src/intent/modules/fol/index.js";
import { AINAgentInfo } from "../src/types/index.js";

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_MODEL_NAME!,
);
const intentAnalyzer = new IntentAnalyzer(model);

const folStore = new FOLLocalStore("fol-store");
const folClient = new FOLClient(model, folStore);

intentAnalyzer.addFOLModule(folClient);

const info: AINAgentInfo = {
  name: "FOL Agent",
  description: "Agent for FOL",
  version: "0.0.3", // Incremented version
};

const agent = new AINAgent(intentAnalyzer, info);

agent.start(Number(process.env.PORT) || 3100);
