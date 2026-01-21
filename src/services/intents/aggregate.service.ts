import { getManifest } from "@/config/manifest";
import type { ModelModule } from "@/modules";
import type { FulfillmentResult, ThreadType } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import {
	AGGREGATE_DECISION_SYSTEM_PROMPT,
	AGGREGATE_GENERATION_SYSTEM_PROMPT,
} from "../utils/aggregate.common";

interface AggregateDecision {
	needsAggregation: boolean;
	reason: string;
}

/**
 * Service for determining whether multiple fulfillment results need to be
 * aggregated into a unified response, and generating that response if needed.
 */
export class AggregateService {
	private modelModule: ModelModule;

	constructor(modelModule: ModelModule) {
		this.modelModule = modelModule;
	}

	/**
	 * Generates a unified response combining all results (always aggregates).
	 * Use this when needsAggregation is already determined to be true.
	 *
	 * @param originalQuery - The user's original query
	 * @param results - Array of fulfillment results from each intent
	 * @returns AsyncGenerator yielding StreamEvent objects
	 */
	public async *aggregate(
		originalQuery: string,
		results: FulfillmentResult[],
	): AsyncGenerator<StreamEvent> {
		// Single result doesn't need aggregation
		if (results.length <= 1) {
			const response = results[0]?.response ?? "";
			if (response) {
				yield {
					event: "text_chunk",
					data: { delta: response },
				};
			}
			return;
		}

		// Emit thinking_process event for aggregate step
		yield {
			event: "thinking_process",
			data: {
				title: `[${getManifest().name}] 응답 통합 중`,
				description: "여러 작업 결과를 하나의 응답으로 통합합니다.",
			},
		};

		// Generate unified response (streaming)
		yield* this.generateAggregatedResponse(originalQuery, results);
	}

	/**
	 * Analyzes fulfillment results and either returns the last response as-is
	 * or generates a unified response combining all results.
	 *
	 * @deprecated Use aggregate() instead when needsAggregation is determined at trigger time
	 * @param originalQuery - The user's original query
	 * @param results - Array of fulfillment results from each intent
	 * @returns AsyncGenerator yielding StreamEvent objects
	 */
	public async *aggregateIfNeeded(
		originalQuery: string,
		results: FulfillmentResult[],
	): AsyncGenerator<StreamEvent> {
		// Single result doesn't need aggregation
		if (results.length <= 1) {
			const response = results[0]?.response ?? "";
			if (response) {
				yield {
					event: "text_chunk",
					data: { delta: response },
				};
			}
			return;
		}

		// Ask LLM whether aggregation is needed
		const decision = await this.shouldAggregate(originalQuery, results);

		loggers.intent.info("Aggregate decision", {
			needsAggregation: decision.needsAggregation,
			reason: decision.reason,
		});

		if (!decision.needsAggregation) {
			// Last response already contains aggregated content
			yield {
				event: "text_chunk",
				data: { delta: results[results.length - 1].response },
			};
			return;
		}

		// Emit thinking_process event for aggregate step
		yield {
			event: "thinking_process",
			data: {
				title: `[${getManifest().name}] 응답 통합 중`,
				description:
					decision.reason || "여러 작업 결과를 하나의 응답으로 통합합니다.",
			},
		};

		// Generate unified response (streaming)
		yield* this.generateAggregatedResponse(originalQuery, results);
	}

	/**
	 * Asks LLM to decide whether the results need to be aggregated.
	 */
	private async shouldAggregate(
		originalQuery: string,
		results: FulfillmentResult[],
	): Promise<AggregateDecision> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();

		const prompt = this.buildDecisionPrompt(originalQuery, results);

		const emptyThread = {
			messages: [],
			userId: "",
			threadId: "",
			type: "CHAT" as ThreadType,
			title: "",
		};

		const messages = modelInstance.generateMessages({
			query: prompt,
			thread: emptyThread,
			systemPrompt: AGGREGATE_DECISION_SYSTEM_PROMPT,
		});

		try {
			const response = await modelInstance.fetchWithContextMessage(
				messages,
				[],
				modelOptions,
			);

			// Extract JSON from response (handle markdown code blocks)
			const responseText = response.content ?? "";
			let jsonStr = responseText;
			const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) {
				jsonStr = jsonMatch[1].trim();
			}

			const parsed = JSON.parse(jsonStr);
			return {
				needsAggregation: parsed.needsAggregation ?? true,
				reason: parsed.reason ?? "",
			};
		} catch (error) {
			loggers.intent.warn(
				"Failed to parse aggregate decision, defaulting to aggregate",
				{
					error,
				},
			);
			// Default to aggregating if parsing fails
			return { needsAggregation: true, reason: "Failed to parse decision" };
		}
	}

	/**
	 * Generates a unified response by streaming from the model.
	 */
	private async *generateAggregatedResponse(
		originalQuery: string,
		results: FulfillmentResult[],
	): AsyncGenerator<StreamEvent> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();

		const prompt = this.buildAggregatePrompt(originalQuery, results);

		const emptyThread = {
			messages: [],
			userId: "",
			threadId: "",
			type: "CHAT" as ThreadType,
			title: "",
		};

		const messages = modelInstance.generateMessages({
			query: prompt,
			thread: emptyThread,
			systemPrompt: AGGREGATE_GENERATION_SYSTEM_PROMPT,
		});

		const stream = await modelInstance.fetchStreamWithContextMessage(
			messages,
			[],
			modelOptions,
		);

		for await (const chunk of stream) {
			if (chunk.delta?.content) {
				yield {
					event: "text_chunk",
					data: { delta: chunk.delta.content },
				};
			}
		}
	}

	/**
	 * Builds the prompt for the aggregation decision.
	 */
	private buildDecisionPrompt(
		originalQuery: string,
		results: FulfillmentResult[],
	): string {
		const resultsText = results
			.map(
				(r, i) =>
					`[Task ${i + 1}] ${r.subquery}\n[Response ${i + 1}] ${r.response}`,
			)
			.join("\n\n---\n\n");

		return `Original Query: ${originalQuery}

Results:
${resultsText}`;
	}

	/**
	 * Builds the prompt for generating an aggregated response.
	 */
	private buildAggregatePrompt(
		originalQuery: string,
		results: FulfillmentResult[],
	): string {
		const resultsText = results
			.map(
				(r, i) =>
					`[Task ${i + 1}] ${r.subquery}\n[Response ${i + 1}] ${r.response}`,
			)
			.join("\n\n---\n\n");

		return `Original Query: ${originalQuery}

All task results:
${resultsText}

Please provide a unified response that addresses the original query.`;
	}
}
