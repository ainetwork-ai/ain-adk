import type { MemoryModule } from "@/modules";

async function aggregatePrompt(
	memoryModule: MemoryModule,
	calculatorEnabled = false,
) {
	const calculatorInstruction = calculatorEnabled
		? `
- If arithmetic is required while combining results, do NOT calculate it yourself. Use the built-in calculator tool and use its exact result.`
		: "";

	const aggregatePrompt =
		(await memoryModule?.getAgentMemory()?.getAggregatePrompt?.()) ||
		`You are an assistant that combines multiple task responses into a single, coherent response.

Guidelines:
- Preserve ALL information from each response, especially numerical data, tables, and statistics
- Tables, numbers, and structured data MUST be included exactly as they appear in the original responses. Do NOT round, approximate, summarize, or omit any values.
- Do not perform arithmetic mentally when a deterministic calculator tool is available.
- Create a natural, flowing response that addresses the original query
- Don't use section headers like "[Task 1]" - integrate smoothly
- If responses have related information, organize them logically while keeping all data intact
- Keep the tone consistent with the original responses
- Respond in the same language as the original query${calculatorInstruction}`;

	return aggregatePrompt;
}

export default aggregatePrompt;
