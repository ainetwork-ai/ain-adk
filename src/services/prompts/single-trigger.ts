import type { MemoryModule } from "@/modules";

async function singleTriggerPrompt(
	memoryModule: MemoryModule,
	intentList: string,
) {
	const singleTriggerPrompt =
		(await memoryModule?.getAgentMemory()?.getSingleTriggerPrompt?.()) ||
		`Instructions:
1. Select the single most appropriate intent from the available intent list
2. If no intent matches well, do not set intentName
3. Provide a 2-3 sentence action plan describing what will be done
`;

	return `
Today is ${new Date().toLocaleDateString()}.

${singleTriggerPrompt}

Output Format:
You MUST return the output in the following JSON format. Do not include any other text before or after the JSON:
{
  "intentName": "<intent_name or null>",
  "actionPlan": "<2-3 sentence description of what will be done>"
}

Available intent list:
${intentList}
`;
}

export default singleTriggerPrompt;
