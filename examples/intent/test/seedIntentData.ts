// 목적: 예시 intents 및 triggerSentences를 DB에 삽입하는 seed 스크립트
// 주의: 기존 데이터가 있으면 삭제하고 새로 삽입합니다.
// 실행: npx tsx examples/intent/seedIntentData.ts

import "dotenv/config";
import mongoose from "mongoose";
import { IntentModel } from "../model/intent.model";
import { IntentTriggeringSentenceModel } from "../model/intentTriggeringSentence.model";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("✅ MongoDB 연결 성공");

  // 기존 데이터 삭제
  await IntentTriggeringSentenceModel.deleteMany({});
  await IntentModel.deleteMany({});
  console.log("🗑️ 기존 Intent, IntentTriggeringSentence 데이터 삭제 완료");

  // 1. 인텐트 데이터
  const intents = [
    {
      name: "check_task_list",
      description: "현재 할당된 태스크(업무) 목록을 확인할 때",
    },
    {
      name: "get_comcom_info",
      description: "ComCom의 기본 정보가 필요할 때",
    },
    {
      name: "check_comcom_welfare",
      description: "ComCom의 복지 및 혜택 정보를 알고 싶을 때",
    },
    {
      name: "check_comcom_rules",
      description: "ComCom의 사내 규칙 및 정책을 확인할 때",
    },
    {
      name: "onboard_new_onprem_server",
      description: "ComCom에서 신규 온프렘(사내) 서버를 구축하거나 온보딩할 때",
    },
  ];

  // 2. 인텐트 삽입
  const inserted = await IntentModel.insertMany(intents);
  console.log("✅ Intent 삽입 완료");

  // 3. 트리거링 센텐스 데이터
  const triggerSentences = [
    // check_task_list
    { intent: inserted[0]._id, sentence: "내 업무 목록 보여줘" },
    { intent: inserted[0]._id, sentence: "오늘 해야 할 일 알려줘" },
    { intent: inserted[0]._id, sentence: "내가 맡은 태스크 뭐야?" },
    { intent: inserted[0]._id, sentence: "현재 진행 중인 일 리스트" },
    { intent: inserted[0]._id, sentence: "할당된 업무 확인" },

    // get_comcom_info
    { intent: inserted[1]._id, sentence: "컴컴이 뭐하는 곳이야?" },
    { intent: inserted[1]._id, sentence: "컴컴 회사 소개해줘" },
    { intent: inserted[1]._id, sentence: "컴컴에 대해 알려줘" },
    { intent: inserted[1]._id, sentence: "컴컴 기본 정보" },
    { intent: inserted[1]._id, sentence: "컴컴이 어떤 회사야?" },

    // check_comcom_welfare
    { intent: inserted[2]._id, sentence: "컴컴 복지 뭐 있어?" },
    { intent: inserted[2]._id, sentence: "컴컴 혜택 알려줘" },
    { intent: inserted[2]._id, sentence: "복지 제도 설명해줘" },
    { intent: inserted[2]._id, sentence: "컴컴에서 받을 수 있는 복지" },
    { intent: inserted[2]._id, sentence: "회사 복지 안내" },

    // check_comcom_rules
    { intent: inserted[3]._id, sentence: "컴컴 사내 규칙 알려줘" },
    { intent: inserted[3]._id, sentence: "회사 정책 설명해줘" },
    { intent: inserted[3]._id, sentence: "컴컴 규정이 뭐야?" },
    { intent: inserted[3]._id, sentence: "사내 정책 안내" },
    { intent: inserted[3]._id, sentence: "규칙/정책 확인" },

    // onboard_new_onprem_server
    { intent: inserted[4]._id, sentence: "새 온프렘 서버 구축하려고 해" },
    { intent: inserted[4]._id, sentence: "온프렘 서버 온보딩 절차 알려줘" },
    { intent: inserted[4]._id, sentence: "사내 서버 새로 띄우는 방법" },
    { intent: inserted[4]._id, sentence: "온프렘 서버 추가하고 싶어" },
    { intent: inserted[4]._id, sentence: "신규 온프렘 서버 세팅 안내" },
  ];

  // 4. 트리거링 센텐스 삽입
  await IntentTriggeringSentenceModel.insertMany(triggerSentences);
  console.log("✅ IntentTriggeringSentence 삽입 완료");

  await mongoose.disconnect();
  console.log("✅ MongoDB 연결 해제");
}

main().catch((err) => {
  console.error("❌ Seed 실패:", err);
  process.exit(1);
}); 