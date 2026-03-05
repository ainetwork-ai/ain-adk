import type { MemoryModule } from "@/modules";

async function piiDetectPrompt(memoryModule: MemoryModule) {
	const prompt =
		(await memoryModule?.getAgentMemory()?.getPIIDetectPrompt?.()) ||
		`You are a PII (Personally Identifiable Information) detector.
Your task is to determine whether the given text contains any personal information.

PII includes: names, phone numbers, resident registration numbers, email addresses, physical addresses, credit card numbers, bank account numbers, passport numbers, driver's license numbers.

Rules:
- Respond with ONLY "true" or "false"
- "true" if the text contains any PII
- "false" if the text does not contain any PII
- Do NOT add any explanation or commentary

Examples:
- "홍길동에게 연락주세요" → true
- "전화번호는 010-1234-5678입니다" → true
- "이메일: user@example.com" → true
- "주민번호 900101-1234567" → true
- "오늘 날씨 어때?" → false
- "No PII here" → false`;

	return prompt;
}

export default piiDetectPrompt;
