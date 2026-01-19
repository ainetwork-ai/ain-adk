import type { MemoryModule, ModelModule } from "@/modules";
import type {
	MessageObject,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";

/**
 * Service for single-intent triggering.
 * Identifies a single intent without decomposing queries into subqueries.
 */
export class SingleIntentTriggerService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	/**
	 * Detects a single intent from context.
	 * Simpler prompt that doesn't decompose queries into subqueries.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns Array with single TriggeredIntent
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<Array<TriggeredIntent>> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const intentMemory = this.memoryModule.getIntentMemory();
		if (!intentMemory) {
			return [{ subquery: query }];
		}

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

Please select and answer only from the above intent list.`;

		const userMessage = `
${
	threadMessages !== ""
		? `The following is the conversation history with the user: ${threadMessages}

	`
		: ""
}
User question: "${query}"

Based on the above conversation history, analyze the user question and identify the most relevant intent.

Instructions:
1. Select the single most appropriate intent from the available intent list
2. If no intent matches well, do not set intentName
3. Provide a 2-3 sentence action plan describing what will be done

Output Format:
You MUST return the output in the following JSON format. Do not include any other text before or after the JSON:
{
  "intentName": "<intent_name or null>",
  "actionPlan": "<2-3 sentence description of what will be done>"
}`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages, modelOptions);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return [{ subquery: query }];
		}

		let parsed: { intentName?: string; actionPlan?: string };
		try {
			parsed = JSON.parse(response.content);
		} catch (error: unknown) {
			return [{ subquery: query }];
		}

		const result: TriggeredIntent = {
			subquery: query,
			actionPlan: parsed.actionPlan,
		};

		if (parsed.intentName) {
			result.intent = await intentMemory.getIntentByName(parsed.intentName);
		}

		return [result];
	}
}
