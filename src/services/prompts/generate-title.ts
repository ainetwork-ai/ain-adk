import type { MemoryModule } from "@/modules";

async function generateTitlePrompt(memoryModule: MemoryModule) {
	const generateTitlePrompt =
		(await memoryModule?.getAgentMemory()?.getGenerateTitlePrompt?.()) ||
		`Today is ${new Date().toLocaleDateString()}.
You are a helpful assistant that generates titles for conversations.
Please analyze the user's query and create a concise title that accurately reflects the conversation's core topic.
The title must be no more than 5 words long.
Respond with only the title. Do not include any punctuation or extra explanations.
Always respond in the same language as the user's input.`;

	return generateTitlePrompt;
}

export default generateTitlePrompt;
