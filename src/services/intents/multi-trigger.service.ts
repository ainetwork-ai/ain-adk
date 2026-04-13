import type { MemoryModule, ModelModule } from "@/modules";
import type {
	IntentTriggerResult,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";
import { serializeThreadForIntent } from "@/utils/message";
import multiTriggerPrompt from "../prompts/multi-trigger";

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
		const threadMessages = serializeThreadForIntent(thread);

		const systemPrompt = await multiTriggerPrompt(
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
Last user question: "${query}"

Based on the above conversation history, analyze the last user question and identify all relevant intents.
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
