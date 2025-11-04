import type { MemoryModule, ModelModule } from "@/modules";
import type {
	MessageObject,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";

export class IntentTriggerService {
	private modelModule: ModelModule;
	private memoryModule?: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule?: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	/**
	 * Detects the intent from context.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns The detected intent
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<Array<TriggeredIntent>> {
		const modelInstance = this.modelModule.getModel();
		const intentMemory = this.memoryModule?.getIntentMemory();
		if (!intentMemory) {
			return [{ subquery: query }];
		}

		// 인텐트 목록 가져오기
		const intents = await intentMemory.listIntents();

		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return [{ subquery: query }];
		}

		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");

		// Convert thread messages to a string
		const threadMessages = !thread
			? ""
			: thread.messages
					.sort((a, b) => a.timestamp - b.timestamp)
					.map((message: MessageObject) => {
						const role =
							message.role === "USER"
								? "User"
								: message.role === "MODEL"
									? "Assistant"
									: "System";
						const content = Array.isArray(message.content.parts)
							? message.content.parts.join(" ")
							: String(message.content.parts);
						return `${role}: """${content}"""`;
					})
					.join("\n");

		const systemPrompt = `
Today is ${new Date().toLocaleDateString()}.
You are an expert in accurately identifying user intentions.

Available intent list:
${intentList}

Please select and answer only from the above intent list. 
Please return only the exact intent name without any additional explanations or text.`;

		const userMessage = `The following is the conversation history with the user:

${threadMessages}

Last user question: "${query}"

Based on the above conversation history, analyze the last user question and identify all relevant intents.

Instructions:
1. First, decompose the last user question into action-based subqueries (each representing a distinct action or task)
2. Then, map each subquery to its corresponding intent from the available intent list
3. For each subquery, provide a 2-3 sentence summary of what actions will be performed
4. Multiple intents can be identified if the question covers various topics or actions
5. Maintain the logical sequence of the original question when splitting into subqueries
6. **Important**: If the query cannot be split into multiple subqueries (i.e., it represents a single action or request), treat the entire query as one subquery and still follow the output format

Output Format:
You MUST return the output in the following JSON format. Do not include any other text before or after the JSON:
[
  {
    "subquery": "<subquery_1>",
    "intentName": "<intent_name_1>",
		"actionPlan": "<2-3 sentence description of what will be done for this subquery>"
	},
  {
    "subquery": "<subquery_2>",
    "intentName": "<intent_name_2>",
		"actionPlan": "<2-3 sentence description of what will be done for this subquery>"
  },
  ...
]

Requirements:
- Each subquery should represent a single, actionable task or request
- Preserve the original meaning and context when splitting queries
- Select only from the provided intent list
- DO NOT set intentName for any subquery that doesn't match available intents.
- Even if the query is simple and cannot be decomposed, return it as a single-element array with one subquery object`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return [{ subquery: query }];
		}

		let subqueries: any;
		try {
			subqueries = JSON.parse(response.content);
		} catch (error: unknown) {
			return [{ subquery: query }];
		}

		const triggeredIntent: Array<TriggeredIntent> = [];
		for (const { subquery, intentName, actionPlan } of subqueries) {
			const item = { subquery, actionPlan } as TriggeredIntent;
			if (intentName) {
				item.intent = await intentMemory.getIntentByName(intentName);
			}
			triggeredIntent.push(item);
		}

		return triggeredIntent;
	}
}
