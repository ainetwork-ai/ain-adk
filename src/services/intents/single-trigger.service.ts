import type { MemoryModule, ModelModule } from "@/modules";
import type {
	IntentTriggerResult,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";
import { serializeThreadForIntent } from "@/utils/message";
import singleTriggerPrompt from "../prompts/single-trigger";

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
	 * @returns IntentTriggerResult with single intent and needsAggregation=false
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

		const intents = await intentMemory.listIntents();
		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");

		// Convert thread messages to a string
		const threadMessages = serializeThreadForIntent(thread);

		const systemPrompt = await singleTriggerPrompt(
			this.memoryModule,
			intentList,
		);

		const triggerMessage = `
${
	threadMessages !== ""
		? `
The following is the conversation history with the user:
${threadMessages}

`
		: ""
}
User question: "${query}"

Based on the above conversation history, analyze the user question and identify the most relevant intent.
`;

		const messages = modelInstance.generateMessages({
			query: triggerMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages, modelOptions);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		let parsed: { intentName?: string; actionPlan?: string };
		try {
			parsed = JSON.parse(response.content);
		} catch (error: unknown) {
			return { intents: [{ subquery: query }], needsAggregation: false };
		}

		const result: TriggeredIntent = {
			subquery: query,
			actionPlan: parsed.actionPlan,
		};

		if (parsed.intentName) {
			result.intent = await intentMemory.getIntentByName(parsed.intentName);
		}

		return { intents: [result], needsAggregation: false };
	}
}
