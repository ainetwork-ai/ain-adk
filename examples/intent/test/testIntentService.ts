// 목적: DB 연결 및 IntentService의 findAllWithTriggerSentences()가 정상 동작하는지 테스트합니다.
// 실행 방법: 환경변수(MONGODB_URI 등) 설정 후 아래 명령어로 실행하세요.
//   npx tsx examples/intent/testIntentService.ts
import "dotenv/config";
import mongoose from "mongoose";
import { IntentService } from "../service/intent.service.js";

async function main() {
  try {
    // DB 연결
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ MongoDB 연결 성공");

    // 서비스 인스턴스 생성
    const service = new IntentService();

    // 인텐트+트리거센텐스 조회
    const intents = await service.findAllWithTriggerSentences();
    console.log("✅ intents:", intents);

    // 연결 해제
    await mongoose.disconnect();
    console.log("✅ MongoDB 연결 해제");
  } catch (err) {
    console.error("❌ 테스트 실패:", err);
    process.exit(1);
  }
}

main(); 