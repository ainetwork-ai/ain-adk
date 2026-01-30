import type { MemoryModule, ModelModule } from "@/modules";
import type {
	IntentTriggerResult,
	MessageObject,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";

/**
 * Service for multi-intent triggering.
 * Decomposes queries into multiple subqueries and maps each to an intent.
 */
export class MultiIntentTriggerService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	/**
	 * Detects multiple intents from context by decomposing queries into subqueries.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns IntentTriggerResult containing intents and aggregation flag
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<IntentTriggerResult> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const intentMemory = this.memoryModule.getIntentMemory();
		if (!intentMemory) {
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		// Get agent memory for additional trigger prompt
		const agentMemory = this.memoryModule.getAgentMemory();
		const additionalTriggerPrompt =
			(await agentMemory?.getAdditionalTriggerPrompt?.()) ?? "";

		// 인텐트 목록 가져오기
		const intents = await intentMemory.listIntents();

		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return { intents: [{ subquery: query }], needsAggregation: false };
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
${
	additionalTriggerPrompt
		? `
Additional Guidelines:
${additionalTriggerPrompt}
`
		: ""
}
Available intent list:
${intentList}

Please select and answer only from the above intent list.`;

		const userMessage = `
${
	threadMessages !== ""
		? `The following is the conversation history with the user: ${threadMessages}

	`
		: ""
}
Last user question: "${query}"

Based on the above conversation history, analyze the last user question and identify all relevant intents.

Instructions:
1. **First, review the available intent list** to understand what intents are available and what each intent can handle
2. **Identify which intents from the list are relevant** to the user's question
3. **Decompose the question based on intent boundaries**:
   - Prioritize splitting the query where each subquery can map to an intent from the available list
   - If a portion of the query matches an available intent, create a subquery for it and set the intentName
   - If a portion of the query does NOT match any available intent, still create a subquery for it but leave intentName empty/null
   - Each subquery should be the minimal unit that represents a coherent request or action
   - If the query maps to a single intent (or single action), keep it as one subquery
4. For each subquery, provide a 2-3 sentence summary of what actions will be performed
5. Maintain the logical sequence of the original question when splitting into subqueries
6. **Important**: Use the intent list as a guide for decomposition, but don't force-fit queries into intents that don't match. It's acceptable to have subqueries without matching intents.
7. Determine if the final response needs aggregation:
   - Set needsAggregation to TRUE if: multiple subqueries exist AND their results should be combined into a unified response
   - Set needsAggregation to FALSE if: only one subquery exists, OR multiple subqueries are independent and can be answered separately without combining

Output Format:
You MUST return the output in the following JSON format. Do not include any other text before or after the JSON:
{
  "needsAggregation": <true or false>,
  "subqueries": [
    {
      "subquery": "<subquery_1>",
      "intentName": "<intent_name_1>",
      "actionPlan": "<2-3 sentence description of what will be done for this subquery>"
    },
    {
      "subquery": "<subquery_2>",
      "intentName": "<intent_name_2>",
      "actionPlan": "<2-3 sentence description of what will be done for this subquery>"
    }
  ]
}

Requirements:
- Prioritize using available intents when decomposing queries
- Use intent boundaries as the primary guide for splitting, but allow subqueries without matching intents when necessary
- Preserve the original meaning and context when splitting queries
- Set intentName only when there's a clear match with an available intent; leave it empty/null otherwise
- Even if the query is simple and maps to a single intent (or action), return it as a single-element array with one subquery object
- Set needsAggregation based on whether the user expects a unified combined answer or separate responses`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages, modelOptions);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		let parsed: {
			needsAggregation?: boolean;
			subqueries?: Array<{
				subquery?: string;
				intentName?: string;
				actionPlan?: string;
			}>;
		};
		try {
			parsed = JSON.parse(response.content);
		} catch (error: unknown) {
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		const subqueries = parsed.subqueries ?? [];
		const needsAggregation = parsed.needsAggregation ?? false;

		const triggeredIntents: Array<TriggeredIntent> = [];
		for (const { subquery, intentName, actionPlan } of subqueries) {
			if (!subquery) continue;
			const item = { subquery, actionPlan } as TriggeredIntent;
			if (intentName) {
				item.intent = await intentMemory.getIntentByName(intentName);
			}
			triggeredIntents.push(item);
		}

		loggers.intent.info("Intent triggering result", {
			intentCount: triggeredIntents.length,
			needsAggregation,
		});

		return { intents: triggeredIntents, needsAggregation };
	}
}
