import "dotenv/config";

import { AzureOpenAI } from "../src/modules/models/providers/openai.js";
import { AINAgent } from "../src/app.js";
import { FOLModule } from "../src/modules/fol/fol.module.js";
import { FOLLocalStore } from "../src/modules/fol/store/index.js";
import { AinAgentManifest } from "../src/types/index.js";
import { ModelModule } from "../src/modules/index.js";

const modelModule = new ModelModule();
const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_MODEL_NAME!,
);
modelModule.addModel('azure-gpt-4o', model);

const folStore = new FOLLocalStore("fol-store");
const folModule = new FOLModule(model, folStore);

const manifest: AinAgentManifest = {
  name: "FOL Agent",
  description: "Agent for FOL",
  version: "0.0.3", // Incremented version
};

const agent = new AINAgent(
  manifest,
  { modelModule, folModule }
);

agent.start(Number(process.env.PORT) || 3100);
