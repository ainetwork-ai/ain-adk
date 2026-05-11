import { WorkflowTableDefinitionBuilder } from "@/services/workflow-table/definition-builder.js";
import { WorkflowTableFormulaEvaluator } from "@/services/workflow-table/formula-evaluator.js";
import { WorkflowTableRenderer } from "@/services/workflow-table/renderer.js";
import type { WorkflowTableBlock } from "@/types/memory.js";

export type { WorkflowTableRenderResult } from "@/services/workflow-table/shared.js";

export class WorkflowTableService {
	private definitionBuilder: WorkflowTableDefinitionBuilder;
	private formulaEvaluator: WorkflowTableFormulaEvaluator;
	private renderer: WorkflowTableRenderer;

	constructor(
		definitionBuilder = new WorkflowTableDefinitionBuilder(),
		formulaEvaluator = new WorkflowTableFormulaEvaluator(),
		renderer = new WorkflowTableRenderer(),
	) {
		this.definitionBuilder = definitionBuilder;
		this.formulaEvaluator = formulaEvaluator;
		this.renderer = renderer;
	}

	isDeterministicTableBlock(block: WorkflowTableBlock): boolean {
		return this.definitionBuilder.isDeterministicTableBlock(block);
	}

	buildExtractionPrompt(
		block: WorkflowTableBlock,
		resultsText: string,
	): string {
		return this.definitionBuilder.buildExtractionPrompt(block, resultsText);
	}

	renderTable(block: WorkflowTableBlock, rawContent: string) {
		if (!this.isDeterministicTableBlock(block)) {
			throw new Error(
				"Workflow table blocks must use the simplified deterministic DSL.",
			);
		}

		if (block.layout === "matrix") {
			const definition = this.definitionBuilder.buildMatrixDefinition(block);
			const { matrix, warnings } = this.formulaEvaluator.evaluateMatrix(
				rawContent,
				definition,
			);
			return this.renderer.renderMatrix(block, definition, matrix, warnings);
		}

		const definition = this.definitionBuilder.buildRecordDefinition(block);
		const { rows, totalRow, warnings } = this.formulaEvaluator.evaluateRecords(
			rawContent,
			definition,
		);
		return this.renderer.renderRecords(
			block,
			definition,
			rows,
			totalRow,
			warnings,
		);
	}
}
