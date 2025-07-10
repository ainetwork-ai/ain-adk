import "dotenv/config";

import { FOLClient, FOLLocalStore } from "../src/intent/modules/fol/index.js";
import GeminiModel from "../src/models/gemini.js";

const model = new GeminiModel(
  process.env.GEMINI_API_KEY!,
  process.env.GEMINI_MODEL_NAME!
);

const folStore = new FOLLocalStore("fol-store");
const folClient = new FOLClient(model, folStore);

const INTENT = "test";
const FACT_TEXT = "John is a student and likes math";
const TEST_QUERY = "Who is a student?";

console.log("debug", "start");

await folClient.updateFacts(INTENT, FACT_TEXT);

console.log("debug", "updateFacts");

const facts = await folClient.retrieveFacts(INTENT);

console.log("debug", facts);

const queryResult = await folClient.queryFacts(INTENT, TEST_QUERY);

console.log(queryResult);
