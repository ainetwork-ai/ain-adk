import { getManifest } from "@/config/manifest";
import type { MemoryModule, ModelModule } from "@/modules";
import {
	type FulfillmentResult,
	MessageRole,
	type ThreadType,
} from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import {
	createModelInputMessage,
	createTextMessage,
	serializeMessageForIntent,
} from "@/utils/message";
import aggregatePrompts from "../prompts/aggregate";

function serializeFulfillmentResult(result: FulfillmentResult): string {
	const responseMessage =
		result.responseMessage ??
		createTextMessage({
			messageId: `legacy-${result.subquery}`,
			role: MessageRole.MODEL,
			timestamp: 0,
			text: result.response,
		});

	return serializeMessageForIntent(responseMessage);
}

/**
 * Service for determining whether multiple fulfillment results need to be
 * aggregated into a unified response, and generating that response if needed.
 */
export class AggregateService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
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
			const response = results[0] ? serializeFulfillmentResult(results[0]) : "";
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
	 * Generates a unified response by streaming from the model.
	 */
	private async *generateAggregatedResponse(
		originalQuery: string,
		results: FulfillmentResult[],
	): AsyncGenerator<StreamEvent> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();

		const query = this.buildAggregateQuery(originalQuery, results);

		const emptyThread = {
			messages: [],
			userId: "",
			threadId: "",
			type: "CHAT" as ThreadType,
			title: "",
		};

		const messages = modelInstance.generateMessages({
			query,
			input: createModelInputMessage({ text: query }),
			thread: emptyThread,
			systemPrompt: await aggregatePrompts(this.memoryModule),
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
	 * Builds the query for generating an aggregated response.
	 */
	private buildAggregateQuery(
		originalQuery: string,
		results: FulfillmentResult[],
	): string {
		const resultsText = results
			.map(
				(result, i) =>
					`[Task ${i + 1}] ${result.subquery}\n[Response ${i + 1}] ${serializeFulfillmentResult(result)}`,
			)
			.join("\n\n---\n\n");

		return `Original Query: ${originalQuery}

All task results:
${resultsText}

Please provide a unified response that addresses the original query.`;
	}
}
