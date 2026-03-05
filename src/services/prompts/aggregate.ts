import type { MemoryModule } from "@/modules";

async function aggregatePrompt(memoryModule: MemoryModule) {
	const aggregatePrompt =
		(await memoryModule?.getAgentMemory()?.getAggregatePrompt?.()) ||
		`You are an assistant that combines multiple task responses into a single, coherent response.

Guidelines:
- Preserve all important information from each response
- Create a natural, flowing response that addresses the original query
- Don't use section headers like "[Task 1]" - integrate smoothly
- If responses have related information, synthesize them logically
- Keep the tone consistent with the original responses
- Be concise - don't add unnecessary filler
- Respond in the same language as the original query`;

	return aggregatePrompt;
}

export default aggregatePrompt;
