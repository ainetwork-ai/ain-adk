import { getManifest } from "@/config/manifest";
import type { MemoryModule, ModelModule } from "@/modules";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import type { FulfillmentResult, ThreadType } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import type { CalculatorService } from "../calculator.service";
import aggregatePrompts from "../prompts/aggregate";
import toolSelectPrompt from "../prompts/tool-select";

/**
 * Service for determining whether multiple fulfillment results need to be
 * aggregated into a unified response, and generating that response if needed.
 */
export class AggregateService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;
	private calculatorService?: CalculatorService;

	constructor(
		modelModule: ModelModule,
		memoryModule: MemoryModule,
		calculatorService?: CalculatorService,
	) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
		this.calculatorService = calculatorService;
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

		const toolPrompt = await toolSelectPrompt(this.memoryModule);
		const tools: ConnectorTool[] = this.calculatorService
			? this.calculatorService.getTools(toolPrompt)
			: [];
		const messages = modelInstance.generateMessages({
			query,
			thread: emptyThread,
			systemPrompt: await aggregatePrompts(this.memoryModule, tools.length > 0),
		});

		while (true) {
			const functions = modelInstance.convertToolsToFunctions(tools);
			const stream = await modelInstance.fetchStreamWithContextMessage(
				messages,
				functions,
				modelOptions,
			);
			const assembledToolCalls: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[] = [];

			for await (const chunk of stream) {
				const delta = chunk.delta;
				if (delta?.tool_calls) {
					for (const { index, id, function: func } of delta.tool_calls) {
						assembledToolCalls[index] ??= {
							id: "",
							type: "function",
							function: { name: "", arguments: "" },
						};

						if (id) assembledToolCalls[index].id = id;
						if (func?.name) assembledToolCalls[index].function.name = func.name;
						if (func?.arguments)
							assembledToolCalls[index].function.arguments += func.arguments;
					}
				} else if (chunk.delta?.content) {
					yield {
						event: "text_chunk",
						data: { delta: chunk.delta.content },
					};
				}
			}

			if (assembledToolCalls.length === 0) {
				break;
			}

			for (const toolCall of assembledToolCalls) {
				const selectedTool = tools.find(
					(tool) => tool.toolName === toolCall.function.name,
				);
				if (
					!selectedTool ||
					selectedTool.protocol !== CONNECTOR_PROTOCOL_TYPE.BUILTIN ||
					!this.calculatorService
				) {
					continue;
				}

				const toolArgs = JSON.parse(toolCall.function.arguments);
				yield {
					event: "thinking_process",
					data: {
						title: `[${getManifest().name}] ${selectedTool.protocol} 실행: ${selectedTool.toolName}`,
						description: `${toolArgs.thinking_text || ""}`,
					},
				};
				const toolResult = this.calculatorService.useTool(
					selectedTool,
					toolArgs,
				);
				modelInstance.appendMessages(messages, toolResult);
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
