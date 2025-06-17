import "dotenv/config";

import OpenAIPTU from "src/modules/models/openai.js";
import { AINAgent } from "../ainagent.js";
import { IntentAnalyzer } from "../modules/intent/analyzer.js";

const agent = new AINAgent();
const model = new OpenAIPTU(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  ""
);
const intentAnalyzer = new IntentAnalyzer(model);

agent.addIntentAnalyzer(intentAnalyzer);
agent.start(Number(process.env.PORT) || 3100);