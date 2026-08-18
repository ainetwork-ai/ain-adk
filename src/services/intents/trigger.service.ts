import type { MemoryModule, ModelModule } from "@/modules";
import type {
	IntentTriggerResult,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";
import {
	createModelInputMessage,
	serializeThreadForIntent,
} from "@/utils/message";
import multiTriggerPrompt from "../prompts/multi-trigger";
import singleTriggerPrompt from "../prompts/single-trigger";

type TriggerOutcome = {
	needsAggregation: boolean;
	parts: Array<{
		subquery: string;
		intentName?: string;
		actionPlan?: string;
	}>;
};

interface TriggerStrategy {
	buildSystemPrompt(
		memoryModule: MemoryModule,
		intentList: string,
	): Promise<string>;
	buildTriggerMessage(threadMessages: string, query: string): string;
	parseResponse(content: string, query: string): TriggerOutcome | null;
	/** Whether to emit the "Intent triggering result" log line after mapping. */
	logIntentResult: boolean;
}

function buildHistoryPreamble(threadMessages: string): string {
	if (threadMessages === "") {
		return "";
	}
	return `
The following is the conversation history with the user:
${threadMessages}

`;
}

const singleStrategy: TriggerStrategy = {
	buildSystemPrompt: (memoryModule, intentList) =>
		singleTriggerPrompt(memoryModule, intentList),
	buildTriggerMessage: (threadMessages, query) => `
${buildHistoryPreamble(threadMessages)}
User question: "${query}"

Based on the above conversation history, analyze the user question and identify the most relevant intent.
`,
	parseResponse: (content, query) => {
		try {
			const parsed = JSON.parse(content) as {
				intentName?: string;
				actionPlan?: string;
			};
			return {
				needsAggregation: false,
				parts: [
					{
						subquery: query,
						intentName: parsed.intentName,
						actionPlan: parsed.actionPlan,
					},
				],
			};
		} catch {
			return null;
		}
	},
	logIntentResult: false,
};

const multiStrategy: TriggerStrategy = {
	buildSystemPrompt: (memoryModule, intentList) =>
		multiTriggerPrompt(memoryModule, intentList),
	buildTriggerMessage: (threadMessages, query) => `
${buildHistoryPreamble(threadMessages)}
Last user question: "${query}"

Based on the above conversation history, analyze the last user question and identify all relevant intents.
`,
	parseResponse: (content) => {
		try {
			const parsed = JSON.parse(content) as {
				needsAggregation?: boolean;
				subqueries?: Array<{
					subquery?: string;
					intentName?: string;
					actionPlan?: string;
				}>;
			};
			const subqueries = parsed.subqueries ?? [];
			return {
				needsAggregation: parsed.needsAggregation ?? false,
				parts: subqueries
					.filter((s): s is { subquery: string } & typeof s =>
						Boolean(s.subquery),
					)
					.map((s) => ({
						subquery: s.subquery,
						intentName: s.intentName,
						actionPlan: s.actionPlan,
					})),
			};
		} catch {
			return null;
		}
	},
	logIntentResult: true,
};

function isMultiIntentDisabled(): boolean {
	const value = process.env.DISABLE_MULTI_INTENTS;
	return value === "true" || value === "1";
}

function emptyResult(query: string): IntentTriggerResult {
	return { intents: [{ subquery: query }], needsAggregation: false };
}

/**
 * Service for intent triggering.
 * Selects a single or multi-intent strategy based on DISABLE_MULTI_INTENTS env var.
 */
export class IntentTriggerService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	/**
	 * Detects intents from the current query and conversation context.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history (optional)
	 * @returns IntentTriggerResult containing triggered intents and aggregation flag
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<IntentTriggerResult> {
		const intentMemory = this.memoryModule.getIntentMemory();
		if (!intentMemory) {
			return emptyResult(query);
		}

		const intents = await intentMemory.listIntents();
		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return emptyResult(query);
		}

		const strategy = isMultiIntentDisabled() ? singleStrategy : multiStrategy;
		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");
		const threadMessages = serializeThreadForIntent(thread);

		const systemPrompt = await strategy.buildSystemPrompt(
			this.memoryModule,
			intentList,
		);
		const triggerMessage = strategy.buildTriggerMessage(threadMessages, query);

		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const messages = modelInstance.generateMessages({
			query: triggerMessage,
			input: createModelInputMessage({ text: triggerMessage }),
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages, modelOptions);
		if (!response.content) {
			loggers.intent.warn("Cannot extract intent from query");
			return emptyResult(query);
		}

		const outcome = strategy.parseResponse(response.content, query);
		if (!outcome) {
			return emptyResult(query);
		}

		const triggeredIntents: Array<TriggeredIntent> = [];
		for (const part of outcome.parts) {
			const item: TriggeredIntent = {
				subquery: part.subquery,
				actionPlan: part.actionPlan,
			};
			if (part.intentName) {
				item.intent = await intentMemory.getIntentByName(part.intentName);
			}
			triggeredIntents.push(item);
		}

		if (strategy.logIntentResult) {
			loggers.intent.info("Intent triggering result", {
				intentCount: triggeredIntents.length,
				needsAggregation: outcome.needsAggregation,
			});
		}

		return {
			intents: triggeredIntents,
			needsAggregation: outcome.needsAggregation,
		};
	}
}
