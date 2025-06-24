import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { FOLClient, FOLLocalStore } from "../src/intent/modules/fol/index.js";

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  ""
);
const intentAnalyzer = new IntentAnalyzer(model);

const folStore = new FOLLocalStore("fol-store");
const folClient = new FOLClient(model, folStore);

intentAnalyzer.addFOLModule(folClient);

const agent = new AINAgent(intentAnalyzer, true);

agent.start(Number(process.env.PORT) || 3100);
