import {
	looksPercentLike,
	type MatrixDefinition,
	type ParsedMatrixFormula,
	type ParsedRecordFormula,
	type RecordDefinition,
} from "@/services/workflow-table/shared.js";
import type { WorkflowTableBlock } from "@/types/memory.js";

export class WorkflowTableDefinitionBuilder {
	isDeterministicTableBlock(block: WorkflowTableBlock): boolean {
		if (block.layout === "matrix") {
			return Array.isArray(block.rows) && block.rows.length > 0;
		}

		return block.layout === "records";
	}

	buildExtractionPrompt(
		block: WorkflowTableBlock,
		resultsText: string,
	): string {
		if (!this.isDeterministicTableBlock(block)) {
			throw new Error(
				"Workflow table blocks must use the simplified deterministic DSL.",
			);
		}

		return block.layout === "matrix"
			? this.buildMatrixExtractionPrompt(block, resultsText)
			: this.buildRecordExtractionPrompt(block, resultsText);
	}

	buildMatrixDefinition(block: WorkflowTableBlock): MatrixDefinition {
		if (block.layout !== "matrix" || !block.rows?.length) {
			throw new Error("Matrix table block requires rows.");
		}

		const rows = [...block.rows];
		const columns = [...block.columns];
		const formulas = (block.formulas || []).map((formula) =>
			this.parseMatrixFormula(formula, rows, columns),
		);
		const computedRowTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "row_sum" ||
							formula.type === "row_share" ||
							formula.type === "row_ratio" ||
							formula.type === "row_delta" ||
							formula.type === "row_rate" ||
							formula.type === "row_growth") &&
						rows.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const computedColumnTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "col_sum" ||
							formula.type === "col_share" ||
							formula.type === "col_ratio" ||
							formula.type === "col_delta" ||
							formula.type === "col_rate" ||
							formula.type === "col_growth") &&
						columns.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const comparisonRowTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "row_delta" ||
							formula.type === "row_rate" ||
							formula.type === "row_growth") &&
						rows.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const comparisonColumnTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "col_delta" ||
							formula.type === "col_rate" ||
							formula.type === "col_growth") &&
						columns.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const percentRows = new Set(
			rows
				.filter(looksPercentLike)
				.concat(
					formulas
						.filter(
							(formula) =>
								formula.type === "row_share" ||
								formula.type === "row_rate" ||
								formula.type === "row_growth",
						)
						.map((formula) => formula.target),
				),
		);
		const percentColumns = new Set(
			columns
				.filter(looksPercentLike)
				.concat(
					formulas
						.filter(
							(formula) =>
								formula.type === "col_share" ||
								formula.type === "col_rate" ||
								formula.type === "col_growth",
						)
						.map((formula) => formula.target),
				),
		);

		return {
			layout: "matrix",
			rowHeader: block.rowHeader || "구분",
			rows,
			columns,
			columnFormats: block.columnFormats || {},
			sourceRows: rows.filter((row) => !computedRowTargets.has(row)),
			sourceColumns: columns.filter(
				(column) => !computedColumnTargets.has(column),
			),
			computedRowTargets,
			computedColumnTargets,
			comparisonRowTargets,
			comparisonColumnTargets,
			percentRows,
			percentColumns,
			formulas,
		};
	}

	buildRecordDefinition(block: WorkflowTableBlock): RecordDefinition {
		if (block.layout !== "records") {
			throw new Error("Record table block requires layout: records.");
		}

		const columns = [...block.columns];
		const formulas = (block.formulas || []).map((formula) =>
			this.parseRecordFormula(formula, columns),
		);
		const totalFormulas = formulas.filter(
			(formula): formula is Extract<ParsedRecordFormula, { type: "total" }> =>
				formula.type === "total",
		);
		if (totalFormulas.length > 1) {
			throw new Error("Record table block supports only one @total formula.");
		}

		const computedColumns = new Set(
			formulas
				.filter(
					(
						formula,
					): formula is Exclude<ParsedRecordFormula, { type: "total" }> =>
						formula.type !== "total",
				)
				.map((formula) => formula.target),
		);
		const percentColumns = new Set(
			columns
				.filter(looksPercentLike)
				.concat(
					formulas
						.filter(
							(
								formula,
							): formula is Exclude<ParsedRecordFormula, { type: "total" }> =>
								formula.type !== "total" && looksPercentLike(formula.target),
						)
						.map((formula) => formula.target),
				),
		);

		return {
			layout: "records",
			columns,
			columnFormats: block.columnFormats || {},
			sourceColumns: columns.filter((column) => !computedColumns.has(column)),
			computedColumns,
			percentColumns,
			formulas,
			totalFormula: totalFormulas[0],
		};
	}

	private buildMatrixExtractionPrompt(
		block: WorkflowTableBlock,
		resultsText: string,
	): string {
		const definition = this.buildMatrixDefinition(block);
		const jsonShape = JSON.stringify(
			Object.fromEntries(
				definition.sourceRows.map((row) => [
					row,
					Object.fromEntries(
						definition.sourceColumns.map((column) => [column, "number | null"]),
					),
				]),
			),
			null,
			2,
		);

		return `Task results:
${resultsText}

Extract only the source matrix values for this workflow table.
Return only a valid JSON object with this exact row and column structure.
Use numbers when values are available.
Use null when a value is missing.
Do not calculate formula rows or formula columns.
Do not include markdown fences or prose.

Table title: ${block.title || ""}
${block.prompt ? `Extra extraction instructions: ${block.prompt}\n` : ""}Row header: ${definition.rowHeader}
Rows to extract:
${definition.sourceRows.map((row) => `- ${row}`).join("\n")}

Columns to extract:
${definition.sourceColumns.map((column) => `- ${column}`).join("\n")}

Formulas for later calculation:
${(block.formulas || []).map((formula) => `- ${formula}`).join("\n") || "- none"}

Expected JSON shape:
${jsonShape}`;
	}

	private buildRecordExtractionPrompt(
		block: WorkflowTableBlock,
		resultsText: string,
	): string {
		const definition = this.buildRecordDefinition(block);
		const formatGuidance = definition.sourceColumns
			.map((column) => {
				const format = definition.columnFormats[column];
				if (format?.kind === "text") {
					return `- ${column}: treat as text/identifier. Preserve the source text exactly and never add digit grouping commas or numeric formatting.`;
				}
				if (format?.kind === "currency") {
					return `- ${column}: return a raw number or null, without currency symbols or display formatting.`;
				}
				if (format?.kind === "percent") {
					return `- ${column}: return a raw numeric value or null. Do not append the % symbol.`;
				}
				return `- ${column}: return a raw ${format?.kind === "number" ? "number" : "string, number,"} or null without display formatting.`;
			})
			.join("\n");
		const jsonShape = JSON.stringify(
			[
				Object.fromEntries(
					definition.sourceColumns.map((column) => [
						column,
						"string | number | null",
					]),
				),
			],
			null,
			2,
		);

		return `Task results:
${resultsText}

Extract only the source rows for this workflow table.
Return only a valid JSON array of objects.
Use string, number, or null values.
Do not calculate computed columns.
Do not add total rows.
Do not apply display formatting such as digit grouping commas, currency symbols, unit suffixes, or percent signs unless the source text itself already contains them and the column is plain text.
Do not include markdown fences or prose.

Table title: ${block.title || ""}
${block.prompt ? `Extra extraction instructions: ${block.prompt}\n` : ""}Columns to extract:
${definition.sourceColumns.map((column) => `- ${column}`).join("\n")}

Column format guidance:
${formatGuidance}

Formulas for later calculation:
${(block.formulas || []).map((formula) => `- ${formula}`).join("\n") || "- none"}

Expected JSON shape:
${jsonShape}`;
	}

	private parseMatrixFormula(
		formula: string,
		rows: string[],
		columns: string[],
	): ParsedMatrixFormula {
		const separatorIndex = formula.indexOf("=");
		if (separatorIndex <= 0) {
			throw new Error(`Invalid table formula: ${formula}`);
		}

		const target = formula.slice(0, separatorIndex).trim();
		const targetIsRow = rows.includes(target);
		const targetIsColumn = columns.includes(target);
		if (!targetIsRow && !targetIsColumn) {
			throw new Error(
				`Table formula target "${target}" must be listed in rows or columns.`,
			);
		}

		const expression = formula.slice(separatorIndex + 1).trim();
		const match = expression.match(/^([a-zA-Z_]+)\((.*)\)$/);
		if (!match) {
			throw new Error(`Unsupported matrix table formula: ${formula}`);
		}

		const fn = match[1];
		const args = match[2]
			.split(",")
			.map((arg) => arg.trim())
			.filter(Boolean);

		if (fn === "sum" || fn === "col_sum") {
			if (!targetIsColumn) {
				throw new Error(
					`Matrix formula "${formula}" uses ${fn}, which requires a column target.`,
				);
			}
			return { raw: formula, target, type: "col_sum", args };
		}

		if (fn === "row_sum") {
			if (!targetIsRow) {
				throw new Error(
					`Matrix formula "${formula}" uses ${fn}, which requires a row target.`,
				);
			}
			for (const arg of args) {
				if (!rows.includes(arg)) {
					throw new Error(
						`Matrix formula "${formula}" references unknown row "${arg}".`,
					);
				}
			}
			return { raw: formula, target, type: "row_sum", args };
		}

		if (args.length !== 2) {
			throw new Error(`Unsupported matrix table formula: ${formula}`);
		}

		const prefixedTypes: Record<string, ParsedMatrixFormula["type"]> = {
			row_share: "row_share",
			row_ratio: "row_ratio",
			row_delta: "row_delta",
			row_rate: "row_rate",
			row_growth: "row_growth",
			col_share: "col_share",
			col_ratio: "col_ratio",
			col_delta: "col_delta",
			col_rate: "col_rate",
			col_growth: "col_growth",
		};
		if (prefixedTypes[fn]) {
			const mappedType = prefixedTypes[fn];
			if (mappedType.startsWith("row_") && !targetIsRow) {
				throw new Error(
					`Matrix formula "${formula}" uses ${fn}, which requires a row target.`,
				);
			}
			if (mappedType.startsWith("col_") && !targetIsColumn) {
				throw new Error(
					`Matrix formula "${formula}" uses ${fn}, which requires a column target.`,
				);
			}
			return {
				raw: formula,
				target,
				type: mappedType,
				args: [args[0], args[1]],
			};
		}

		switch (fn) {
			case "share":
			case "ratio":
			case "delta":
			case "rate":
			case "growth":
				return {
					raw: formula,
					target,
					type: `${targetIsRow ? "row" : "col"}_${fn}` as ParsedMatrixFormula["type"],
					args: [args[0], args[1]],
				};
		}

		throw new Error(`Unsupported matrix table formula: ${formula}`);
	}

	private parseRecordFormula(
		formula: string,
		columns: string[],
	): ParsedRecordFormula {
		const totalMatch = formula.match(/^@total\s*=\s*sum\((.*)\)$/i);
		if (totalMatch) {
			const totalColumns = totalMatch[1]
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			for (const column of totalColumns) {
				if (!columns.includes(column)) {
					throw new Error(
						`Unknown column "${column}" in record total formula: ${formula}`,
					);
				}
			}
			return {
				raw: formula,
				type: "total",
				columns: totalColumns,
			};
		}

		const sumMatch = formula.match(/^(.+?)\s*=\s*sum\((.*)\)$/);
		if (sumMatch) {
			const [, rawTarget, rawColumns] = sumMatch;
			const target = rawTarget.trim();
			if (!columns.includes(target)) {
				throw new Error(
					`Unknown column "${target}" in record formula: ${formula}`,
				);
			}

			const requestedColumns = rawColumns
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			const resolvedColumns =
				requestedColumns.length === 1 && requestedColumns[0] === "*"
					? columns.filter((column) => column !== target)
					: requestedColumns;

			for (const column of resolvedColumns) {
				if (!columns.includes(column)) {
					throw new Error(
						`Unknown column "${column}" in record formula: ${formula}`,
					);
				}
			}

			return {
				raw: formula,
				type: "sum",
				target,
				columns: resolvedColumns,
			};
		}

		const assignmentMatch = formula.match(/^(.+?)\s*=\s*(.+)$/);
		if (!assignmentMatch) {
			throw new Error(`Unsupported record table formula: ${formula}`);
		}

		const [, rawTarget, rawExpression] = assignmentMatch;
		const target = rawTarget.trim();
		if (!columns.includes(target)) {
			throw new Error(
				`Unknown column "${target}" in record formula: ${formula}`,
			);
		}

		const { operands, operators } = this.parseRecordExpression(
			rawExpression,
			columns,
			formula,
		);

		return {
			raw: formula,
			type: "expression",
			target,
			operands,
			operators,
		};
	}

	private parseRecordExpression(
		expression: string,
		columns: string[],
		formula: string,
	): {
		operands: string[];
		operators: Array<"+" | "-" | "*" | "/">;
	} {
		const operands: string[] = [];
		const operators: Array<"+" | "-" | "*" | "/"> = [];
		const sortedColumns = [...columns].sort(
			(left, right) => right.length - left.length,
		);
		let index = 0;

		while (index < expression.length) {
			while (index < expression.length && /\s/.test(expression[index])) {
				index += 1;
			}

			const matchedColumn = sortedColumns.find((column) =>
				expression.startsWith(column, index),
			);
			if (!matchedColumn) {
				throw new Error(`Unsupported record table formula: ${formula}`);
			}

			operands.push(matchedColumn);
			index += matchedColumn.length;

			while (index < expression.length && /\s/.test(expression[index])) {
				index += 1;
			}

			if (index >= expression.length) {
				break;
			}

			const operator = expression[index];
			if (!["+", "-", "*", "/"].includes(operator)) {
				throw new Error(`Unsupported record table formula: ${formula}`);
			}
			operators.push(operator as "+" | "-" | "*" | "/");
			index += 1;
		}

		if (operands.length < 2 || operators.length !== operands.length - 1) {
			throw new Error(`Unsupported record table formula: ${formula}`);
		}

		return { operands, operators };
	}
}
