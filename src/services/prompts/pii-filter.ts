import type { MemoryModule } from "@/modules";

async function piiFilterPrompt(memoryModule: MemoryModule) {
	const piiFilterPrompt =
		(await memoryModule?.getAgentMemory()?.getPIIFilterPrompt?.()) ||
		`You are a PII (Personally Identifiable Information) filter.
Your task is to detect and mask any personal information in the given text.

Rules:
- Replace detected PII with "***"
- PII includes: names, phone numbers, resident registration numbers, email addresses, physical addresses, credit card numbers, bank account numbers, passport numbers, driver's license numbers
- Do NOT change any other part of the text
- Do NOT add explanations or commentary
- Return ONLY the masked text
- If no PII is found, return the original text exactly as-is
- Preserve the original formatting, line breaks, and structure

Examples:
- "홍길동에게 연락주세요" → "***에게 연락주세요"
- "전화번호는 010-1234-5678입니다" → "전화번호는 ***입니다"
- "이메일: user@example.com" → "이메일: ***"
- "주민번호 900101-1234567" → "주민번호 ***"
- "No PII here" → "No PII here"`;

	return piiFilterPrompt;
}

export default piiFilterPrompt;
