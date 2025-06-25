import "dotenv/config";

import AzureOpenAI from "../src/models/openai.js";
import { FOLClient, FOLLocalStore } from "../src/intent/modules/fol/index.js";

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_MODEL_NAME!,
  ""
);

const folStore = new FOLLocalStore("fol-store");
const folClient = new FOLClient(model, folStore);

console.log("debug", "start");

await folClient.updateFacts("test", "John is a student and likes math");

console.log("debug", "updateFacts");

const facts = await folClient.retrieveFacts("test");

console.log("debug", facts);

const queryResult = await folClient.queryFacts(
  "test",
  "누가 수학을 좋아하나요?"
);

console.log(queryResult);
