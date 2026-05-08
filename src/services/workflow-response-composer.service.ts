import type { ModelModule } from "@/modules";
import { WorkflowGraphService } from "@/services/workflow-graph.service.js";
import { WorkflowTableService } from "@/services/workflow-table.service.js";
import type {
	WorkflowGraphBlock,
	WorkflowRenderedBlock,
	WorkflowResponseBlock,
	WorkflowTableBlock,
	WorkflowTaskResult,
	WorkflowTextBlock,
} from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";

export class WorkflowResponseComposer {
	private modelModule: ModelModule;
	private workflowGraphService: WorkflowGraphService;
	private workflowTableService: WorkflowTableService;

	constructor(
		modelModule: ModelModule,
		workflowTableService = new WorkflowTableService(),
		workflowGraphService = new WorkflowGraphService(),
	) {
		this.modelModule = modelModule;
		this.workflowTableService = workflowTableService;
		this.workflowGraphService = workflowGraphService;
	}

	async *renderResponseBlock(
		block: WorkflowResponseBlock,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<StreamEvent, WorkflowRenderedBlock, unknown> {
		if (block.type === "heading") {
			const level = block.level ?? 2;
			const content = `${"#".repeat(level)} ${block.text}\n\n`;
			yield { event: "text_chunk", data: { delta: content } };
			return {
				blockId: block.blockId,
				type: block.type,
				content,
			};
		}

		if (block.type === "table") {
			const rendered = yield* this.renderDeterministicTableBlock(
				block,
				taskResults,
			);
			return {
				blockId: block.blockId,
				type: block.type,
				content: rendered.content,
				data: rendered.data,
			};
		}

		if (block.type === "graph") {
			const rendered = yield* this.renderDeterministicGraphBlock(
				block,
				taskResults,
			);
			return {
				blockId: block.blockId,
				type: block.type,
				content: rendered.content,
				data: rendered.data,
			};
		}

		const content = yield* this.renderGeneratedTextBlock(
			block,
			taskResults,
			"Generate this workflow response text from the task results. Return only the response block content.",
		);

		const finalContent = content.endsWith("\n\n") ? content : `${content}\n\n`;
		if (finalContent !== content) {
			yield { event: "text_chunk", data: { delta: "\n\n" } };
		}

		return {
			blockId: block.blockId,
			type: block.type,
			content: finalContent,
		};
	}

	private async *renderDeterministicTableBlock(
		block: WorkflowTableBlock,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<
		StreamEvent,
		ReturnType<WorkflowTableService["renderTable"]>,
		unknown
	> {
		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const sourceResults = this.getSourceTaskResults(block, taskResults);
		const messages = model.generateMessages({
			query: this.workflowTableService.buildExtractionPrompt(
				block,
				this.serializeTaskResults(sourceResults),
			),
			systemPrompt:
				"Extract only the requested table source values as valid JSON. Return only JSON.",
		});
		const response = await model.fetch(messages, modelOptions);
		const rawContent = response.content || "{}";
		const rendered = this.workflowTableService.renderTable(block, rawContent);
		yield { event: "text_chunk", data: { delta: rendered.content } };
		return rendered;
	}

	private async *renderDeterministicGraphBlock(
		block: WorkflowGraphBlock,
		taskResults: Record<string, WorkflowTaskResult>,
	): AsyncGenerator<
		StreamEvent,
		ReturnType<WorkflowGraphService["renderGraph"]>,
		unknown
	> {
		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const sourceResults = this.getSourceTaskResults(block, taskResults);
		const messages = model.generateMessages({
			query: this.workflowGraphService.buildExtractionPrompt(
				block,
				this.serializeTaskResults(sourceResults),
			),
			systemPrompt:
				"Extract only the requested graph source values as valid JSON. Return only JSON.",
		});
		const response = await model.fetch(messages, modelOptions);
		const rawContent = response.content || "{}";
		const rendered = this.workflowGraphService.renderGraph(block, rawContent);
		yield { event: "text_chunk", data: { delta: rendered.content } };
		return rendered;
	}

	private async *renderGeneratedTextBlock(
		block: WorkflowTextBlock,
		taskResults: Record<string, WorkflowTaskResult>,
		systemPrompt: string,
	): AsyncGenerator<StreamEvent, string, unknown> {
		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const sourceResults = this.getSourceTaskResults(block, taskResults);
		const messages = model.generateMessages({
			query: this.buildBlockPrompt(block, sourceResults),
			systemPrompt,
		});
		const stream = await model.fetchStreamWithContextMessage(
			messages,
			[],
			modelOptions,
		);

		let content = "";
		for await (const chunk of stream) {
			if (chunk.delta?.content) {
				content += chunk.delta.content;
				yield {
					event: "text_chunk",
					data: { delta: chunk.delta.content },
				};
			}
		}

		return content;
	}

	private getSourceTaskResults(
		block: Exclude<WorkflowResponseBlock, { type: "heading" }>,
		taskResults: Record<string, WorkflowTaskResult>,
	): WorkflowTaskResult[] {
		if (!block.sourceTaskIds || block.sourceTaskIds.length === 0) {
			return Object.values(taskResults);
		}

		return block.sourceTaskIds
			.map((taskId) => taskResults[taskId])
			.filter((result): result is WorkflowTaskResult => Boolean(result));
	}

	private buildBlockPrompt(
		block: WorkflowTextBlock,
		taskResults: WorkflowTaskResult[],
	): string {
		const resultsText = this.serializeTaskResults(taskResults);
		return `Task results:
${resultsText}

Instructions:
${block.prompt}`;
	}

	private serializeTaskResults(taskResults: WorkflowTaskResult[]): string {
		return taskResults
			.map(
				(result) =>
					`[${result.taskId}] ${result.title}\nStatus: ${result.status}\nResult:\n${result.content || result.error || ""}`,
			)
			.join("\n\n---\n\n");
	}
}
