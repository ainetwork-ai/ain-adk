import "dotenv/config";

import { FOLClient, FOLLocalStore } from "../src/intent/modules/fol/index.js";
import GeminiModel from "../src/models/gemini.js";

const model = new GeminiModel(
  process.env.GEMINI_API_KEY!,
  process.env.GEMINI_MODEL_NAME!
);

const folStore = new FOLLocalStore("fol-store");
const folClient = new FOLClient(model, folStore);

const FACT_TEXT = `한양대학교 수강신청
최소 및 최대 학점 수 준수 학생별 매 학기 최소 및 최대 학점 수를 준수하여야 하며 이는 , 모든 수강정정 기간
완료 시까지의 신청 학점으로 결정됩니다 수강신청 . 학점 수가 미달 또는 초과될 경우 전체 수강신청이 무효 처리되며
해당학기는 평점 0.00 처리 및 학사경고가 부여됩니다.`;
const TEST_QUERY = "수강신청 언제야?";

console.log("debug", "start");

await folClient.updateFacts(FACT_TEXT);

const facts = await folClient.getFactsList();

const queryResult = await folClient.inferenceBasedOnFOLs(TEST_QUERY);
