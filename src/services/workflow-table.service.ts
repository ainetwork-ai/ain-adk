import type {
	WorkflowRenderedTableData,
	WorkflowTableBlock,
} from "@/types/memory.js";

type NumericCellValue = number | null;
type RecordCellValue = string | number | null;
type RecordTableRow = Record<string, RecordCellValue>;
type MatrixTable = Record<string, Record<string, NumericCellValue>>;

type ParsedMatrixFormula =
	| {
			raw: string;
			target: string;
			type: "sum";
			args: string[];
	  }
	| {
			raw: string;
			target: string;
			type: "share";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "ratio";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "delta" | "rate" | "growth";
			args: [string, string];
	  };

type ParsedRecordFormula =
	| {
			raw: string;
			type: "binary";
			target: string;
			left: string;
			operator: "+" | "-" | "*" | "/";
			right: string;
	  }
	| {
			raw: string;
			type: "total";
			columns: string[];
	  };

type MatrixDefinition = {
	layout: "matrix";
	rowHeader: string;
	rows: string[];
	columns: string[];
	sourceRows: string[];
	sourceColumns: string[];
	computedRowTargets: Set<string>;
	computedColumnTargets: Set<string>;
	comparisonColumnTargets: Set<string>;
	percentRows: Set<string>;
	percentColumns: Set<string>;
	formulas: ParsedMatrixFormula[];
};

type RecordDefinition = {
	layout: "records";
	columns: string[];
	sourceColumns: string[];
	computedColumns: Set<string>;
	percentColumns: Set<string>;
	formulas: ParsedRecordFormula[];
	totalFormula?: Extract<ParsedRecordFormula, { type: "total" }>;
};

export type WorkflowTableRenderResult = {
	content: string;
	data: WorkflowRenderedTableData;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function normalizeNumberishString(value: string): string {
	const trimmed = value.trim();
	const negativeParentheses =
		trimmed.startsWith("(") && trimmed.endsWith(")")
			? `-${trimmed.slice(1, -1)}`
			: trimmed;
	return negativeParentheses
		.replace(/[%,$₩원]/g, "")
		.replace(/,/g, "")
		.trim();
}

function parseNumberish(value: unknown): NumericCellValue {
	if (value === null || value === undefined || value === "") {
		return null;
	}

	if (isFiniteNumber(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (
		trimmed.length === 0 ||
		trimmed === "-" ||
		trimmed.toLowerCase() === "null" ||
		trimmed.toLowerCase() === "n/a"
	) {
		return null;
	}

	const normalized = normalizeNumberishString(trimmed);
	if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
		return null;
	}

	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseRecordCell(value: unknown): RecordCellValue {
	if (value === null || value === undefined || value === "") {
		return null;
	}

	if (isFiniteNumber(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (
		trimmed.length === 0 ||
		trimmed === "-" ||
		trimmed.toLowerCase() === "null" ||
		trimmed.toLowerCase() === "n/a"
	) {
		return null;
	}

	const parsed = parseNumberish(trimmed);
	return parsed === null ? trimmed : parsed;
}

function formatNumber(value: number, isPercent: boolean): string {
	const formatted = value.toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 1,
	});
	return isPercent ? `${formatted}%` : formatted;
}

function safeDivide(
	numerator: NumericCellValue,
	denominator: NumericCellValue,
	warnings: string[],
	context: string,
	multiplier = 1,
): NumericCellValue {
	if (numerator === null || denominator === null) {
		return null;
	}
	if (denominator === 0) {
		warnings.push(`Skipped ${context} because the denominator is 0.`);
		return null;
	}
	return (numerator / denominator) * multiplier;
}

function looksPercentLike(value: string): boolean {
	return /%|Pct|Growth/i.test(value);
}

export class WorkflowTableService {
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

	renderTable(
		block: WorkflowTableBlock,
		rawContent: string,
	): WorkflowTableRenderResult {
		if (!this.isDeterministicTableBlock(block)) {
			throw new Error(
				"Workflow table blocks must use the simplified deterministic DSL.",
			);
		}

		return block.layout === "matrix"
			? this.renderMatrixTable(block, rawContent)
			: this.renderRecordTable(block, rawContent);
	}

	private buildMatrixDefinition(block: WorkflowTableBlock): MatrixDefinition {
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
						(formula.type === "share" || formula.type === "ratio") &&
						rows.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const computedColumnTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "sum" ||
							formula.type === "delta" ||
							formula.type === "rate" ||
							formula.type === "growth") &&
						columns.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const comparisonColumnTargets = new Set(
			formulas
				.filter(
					(formula) =>
						(formula.type === "delta" ||
							formula.type === "rate" ||
							formula.type === "growth") &&
						columns.includes(formula.target),
				)
				.map((formula) => formula.target),
		);
		const percentRows = new Set(
			rows
				.filter(looksPercentLike)
				.concat(
					formulas
						.filter((formula) => formula.type === "share")
						.map((formula) => formula.target),
				),
		);
		const percentColumns = new Set(
			columns
				.filter(looksPercentLike)
				.concat(
					formulas
						.filter(
							(formula) => formula.type === "rate" || formula.type === "growth",
						)
						.map((formula) => formula.target),
				),
		);

		return {
			layout: "matrix",
			rowHeader: block.rowHeader || "구분",
			rows,
			columns,
			sourceRows: rows.filter((row) => !computedRowTargets.has(row)),
			sourceColumns: columns.filter(
				(column) => !computedColumnTargets.has(column),
			),
			computedRowTargets,
			computedColumnTargets,
			comparisonColumnTargets,
			percentRows,
			percentColumns,
			formulas,
		};
	}

	private buildRecordDefinition(block: WorkflowTableBlock): RecordDefinition {
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
					): formula is Extract<ParsedRecordFormula, { type: "binary" }> =>
						formula.type === "binary",
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
							): formula is Extract<ParsedRecordFormula, { type: "binary" }> =>
								formula.type === "binary" &&
								(formula.operator === "/" || looksPercentLike(formula.target)),
						)
						.map((formula) => formula.target),
				),
		);

		return {
			layout: "records",
			columns,
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
Do not include markdown fences or prose.

Table title: ${block.title || ""}
${block.prompt ? `Extra extraction instructions: ${block.prompt}\n` : ""}Columns to extract:
${definition.sourceColumns.map((column) => `- ${column}`).join("\n")}

Formulas for later calculation:
${(block.formulas || []).map((formula) => `- ${formula}`).join("\n") || "- none"}

Expected JSON shape:
${jsonShape}`;
	}

	private renderMatrixTable(
		block: WorkflowTableBlock,
		rawContent: string,
	): WorkflowTableRenderResult {
		const definition = this.buildMatrixDefinition(block);
		const warnings: string[] = [];
		const extracted = this.parseMatrixContent(
			rawContent,
			definition.sourceRows,
			definition.sourceColumns,
		);
		const matrix = this.createEmptyMatrix(definition.rows, definition.columns);

		for (const row of definition.sourceRows) {
			for (const column of definition.sourceColumns) {
				matrix[row][column] = extracted[row]?.[column] ?? null;
			}
		}

		for (const formula of definition.formulas) {
			this.applyMatrixFormula(formula, definition, matrix, warnings);
		}

		return {
			content: this.renderMarkdownMatrix(definition, matrix),
			data: this.buildMatrixRenderedData(block, definition, matrix, warnings),
		};
	}

	private renderRecordTable(
		block: WorkflowTableBlock,
		rawContent: string,
	): WorkflowTableRenderResult {
		const definition = this.buildRecordDefinition(block);
		const warnings: string[] = [];
		const rows = this.parseRecordContent(rawContent, definition.sourceColumns);

		for (const formula of definition.formulas) {
			if (formula.type === "binary") {
				this.applyRecordBinaryFormula(formula, rows, warnings);
			}
		}

		const totalRow = definition.totalFormula
			? this.buildRecordTotalRow(definition, rows)
			: undefined;

		return {
			content: this.renderMarkdownRecords(definition, rows, totalRow),
			data: this.buildRecordRenderedData(
				block,
				definition,
				rows,
				totalRow,
				warnings,
			),
		};
	}

	private buildMatrixRenderedData(
		block: WorkflowTableBlock,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): WorkflowRenderedTableData {
		return {
			spec: {
				layout: "matrix",
				rowHeader: definition.rowHeader,
				rows: definition.rows,
				columns: definition.columns,
				formulas: block.formulas,
			},
			table: {
				headers: [definition.rowHeader, ...definition.columns],
				rows: definition.rows.map((row) => ({
					key: row,
					kind: "data",
					cells: [
						row,
						...definition.columns.map(
							(column) => matrix[row]?.[column] ?? null,
						),
					],
				})),
			},
			warnings,
		};
	}

	private buildRecordRenderedData(
		block: WorkflowTableBlock,
		definition: RecordDefinition,
		rows: RecordTableRow[],
		totalRow: RecordTableRow | undefined,
		warnings: string[],
	): WorkflowRenderedTableData {
		return {
			spec: {
				layout: "records",
				columns: definition.columns,
				formulas: block.formulas,
			},
			table: {
				headers: definition.columns,
				rows: [
					...rows.map((row) => ({
						kind: "data" as const,
						cells: definition.columns.map((column) => row[column] ?? null),
					})),
					...(totalRow
						? [
								{
									kind: "total" as const,
									cells: definition.columns.map(
										(column) => totalRow[column] ?? null,
									),
								},
							]
						: []),
				],
			},
			warnings,
		};
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
		if (!rows.includes(target) && !columns.includes(target)) {
			throw new Error(
				`Table formula target "${target}" must be listed in rows or columns.`,
			);
		}

		const expression = formula.slice(separatorIndex + 1).trim();
		const match = expression.match(/^([a-zA-Z]+)\((.*)\)$/);
		if (!match) {
			throw new Error(`Unsupported matrix table formula: ${formula}`);
		}

		const fn = match[1];
		const args = match[2]
			.split(",")
			.map((arg) => arg.trim())
			.filter(Boolean);

		switch (fn) {
			case "sum":
				return { raw: formula, target, type: "sum", args };
			case "share":
			case "ratio":
			case "delta":
			case "rate":
			case "growth":
				if (args.length !== 2) {
					break;
				}
				return {
					raw: formula,
					target,
					type: fn,
					args: [args[0], args[1]],
				};
		}

		throw new Error(`Unsupported matrix table formula: ${formula}`);
	}

	private parseRecordFormula(
		formula: string,
		columns: string[],
	): ParsedRecordFormula {
		const totalMatch = formula.match(/^@total\s*=\s*sum\((.*)\)$/);
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

		const binaryMatch = formula.match(/^(.+?)\s*=\s*(.+?)\s*([+\-*/])\s*(.+)$/);
		if (!binaryMatch) {
			throw new Error(`Unsupported record table formula: ${formula}`);
		}

		const [, target, left, operator, right] = binaryMatch;
		for (const column of [target.trim(), left.trim(), right.trim()]) {
			if (!columns.includes(column)) {
				throw new Error(
					`Unknown column "${column}" in record formula: ${formula}`,
				);
			}
		}

		return {
			raw: formula,
			type: "binary",
			target: target.trim(),
			left: left.trim(),
			operator: operator as "+" | "-" | "*" | "/",
			right: right.trim(),
		};
	}

	private parseMatrixContent(
		rawContent: string,
		rows: string[],
		columns: string[],
	): MatrixTable {
		const jsonText = this.extractJsonValue(rawContent, "object");
		const parsed = JSON.parse(jsonText) as Record<string, unknown>;
		const matrix = this.createEmptyMatrix(rows, columns);

		for (const row of rows) {
			const rowValue = parsed[row];
			if (
				!rowValue ||
				typeof rowValue !== "object" ||
				Array.isArray(rowValue)
			) {
				continue;
			}

			for (const column of columns) {
				matrix[row][column] = parseNumberish(
					(rowValue as Record<string, unknown>)[column],
				);
			}
		}

		return matrix;
	}

	private parseRecordContent(
		rawContent: string,
		sourceColumns: string[],
	): RecordTableRow[] {
		const jsonText = this.extractJsonValue(rawContent, "array");
		const parsed = JSON.parse(jsonText) as unknown;
		if (!Array.isArray(parsed)) {
			throw new Error("Record table extraction did not return a JSON array.");
		}

		return parsed
			.filter(
				(item): item is Record<string, unknown> =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
			.map((item) =>
				Object.fromEntries(
					sourceColumns.map((column) => [
						column,
						parseRecordCell(item[column]),
					]),
				),
			);
	}

	private extractJsonValue(
		rawContent: string,
		expected: "object" | "array",
	): string {
		const trimmed = rawContent.trim();
		const unfenced = trimmed.startsWith("```")
			? trimmed
					.replace(/^```[a-zA-Z]*\n?/, "")
					.replace(/\n?```$/, "")
					.trim()
			: trimmed;

		if (expected === "array") {
			const firstBracket = unfenced.indexOf("[");
			const lastBracket = unfenced.lastIndexOf("]");
			if (
				firstBracket === -1 ||
				lastBracket === -1 ||
				lastBracket < firstBracket
			) {
				throw new Error("Table extraction did not return a JSON array.");
			}
			return unfenced.slice(firstBracket, lastBracket + 1);
		}

		const firstBrace = unfenced.indexOf("{");
		const lastBrace = unfenced.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
			throw new Error("Table extraction did not return a JSON object.");
		}
		return unfenced.slice(firstBrace, lastBrace + 1);
	}

	private createEmptyMatrix(rows: string[], columns: string[]): MatrixTable {
		return Object.fromEntries(
			rows.map((row) => [
				row,
				Object.fromEntries(columns.map((column) => [column, null])),
			]),
		);
	}

	private applyMatrixFormula(
		formula: ParsedMatrixFormula,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		switch (formula.type) {
			case "sum":
				for (const row of definition.rows) {
					const values = formula.args.map(
						(column) => matrix[row]?.[column] ?? null,
					);
					matrix[row][formula.target] = values.every((value) => value === null)
						? null
						: values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
				}
				return;
			case "share":
				this.applyMatrixShareFormula(formula, definition, matrix, warnings);
				return;
			case "ratio":
				this.applyMatrixRatioFormula(formula, definition, matrix, warnings);
				return;
			case "delta":
			case "rate":
			case "growth":
				this.applyMatrixComparisonFormula(
					formula,
					definition,
					matrix,
					warnings,
				);
				return;
		}
	}

	private applyMatrixShareFormula(
		formula: Extract<ParsedMatrixFormula, { type: "share" }>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [sourceRow, baseColumn] = formula.args;
		const baseIndex = definition.columns.indexOf(baseColumn);
		if (baseIndex === -1 || !matrix[sourceRow]) {
			throw new Error(`Invalid share formula: ${formula.raw}`);
		}

		const baseValue = matrix[sourceRow][baseColumn];
		for (const [index, column] of definition.columns.entries()) {
			if (index > baseIndex || definition.comparisonColumnTargets.has(column)) {
				matrix[formula.target][column] = null;
				continue;
			}

			matrix[formula.target][column] = safeDivide(
				matrix[sourceRow][column],
				baseValue,
				warnings,
				`${formula.target}.${column}`,
				100,
			);
		}
	}

	private applyMatrixRatioFormula(
		formula: Extract<ParsedMatrixFormula, { type: "ratio" }>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [numeratorRow, denominatorRow] = formula.args;
		if (!matrix[numeratorRow] || !matrix[denominatorRow]) {
			throw new Error(`Invalid ratio formula: ${formula.raw}`);
		}

		for (const column of definition.columns) {
			if (definition.comparisonColumnTargets.has(column)) {
				matrix[formula.target][column] = null;
				continue;
			}

			matrix[formula.target][column] = safeDivide(
				matrix[numeratorRow][column],
				matrix[denominatorRow][column],
				warnings,
				`${formula.target}.${column}`,
			);
		}
	}

	private applyMatrixComparisonFormula(
		formula: Extract<
			ParsedMatrixFormula,
			{ type: "delta" | "rate" | "growth" }
		>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [leftColumn, rightColumn] = formula.args;
		for (const row of definition.rows) {
			const leftValue = matrix[row]?.[leftColumn] ?? null;
			const rightValue = matrix[row]?.[rightColumn] ?? null;

			switch (formula.type) {
				case "delta":
					matrix[row][formula.target] =
						leftValue === null || rightValue === null
							? null
							: leftValue - rightValue;
					break;
				case "rate":
					matrix[row][formula.target] = safeDivide(
						leftValue,
						rightValue,
						warnings,
						`${row}.${formula.target}`,
						100,
					);
					break;
				case "growth":
					if (leftValue === null || rightValue === null) {
						matrix[row][formula.target] = null;
						break;
					}
					matrix[row][formula.target] = safeDivide(
						leftValue - rightValue,
						rightValue,
						warnings,
						`${row}.${formula.target}`,
						100,
					);
					break;
			}
		}
	}

	private applyRecordBinaryFormula(
		formula: Extract<ParsedRecordFormula, { type: "binary" }>,
		rows: RecordTableRow[],
		warnings: string[],
	): void {
		for (const row of rows) {
			const left = parseNumberish(row[formula.left]);
			const right = parseNumberish(row[formula.right]);
			let result: NumericCellValue = null;

			switch (formula.operator) {
				case "+":
					result = left === null || right === null ? null : left + right;
					break;
				case "-":
					result = left === null || right === null ? null : left - right;
					break;
				case "*":
					result = left === null || right === null ? null : left * right;
					break;
				case "/":
					result = safeDivide(left, right, warnings, `${formula.target}`);
					break;
			}

			row[formula.target] = result;
		}
	}

	private buildRecordTotalRow(
		definition: RecordDefinition,
		rows: RecordTableRow[],
	): RecordTableRow {
		const totalRow = Object.fromEntries(
			definition.columns.map((column) => [column, null]),
		) as RecordTableRow;

		if (definition.columns.length > 0) {
			totalRow[definition.columns[0]] = "Total";
		}

		for (const column of definition.totalFormula?.columns || []) {
			const numericValues = rows
				.map((row) => parseNumberish(row[column]))
				.filter((value): value is number => value !== null);
			totalRow[column] =
				numericValues.length === 0
					? null
					: numericValues.reduce((sum, value) => sum + value, 0);
		}

		return totalRow;
	}

	private renderMarkdownMatrix(
		definition: MatrixDefinition,
		matrix: MatrixTable,
	): string {
		const lines = [
			`| ${[definition.rowHeader, ...definition.columns].join(" | ")} |`,
			`| ${["---", ...definition.columns.map(() => "---:")].join(" | ")} |`,
		];

		for (const row of definition.rows) {
			const values = definition.columns.map((column) =>
				this.formatNumericCell(
					matrix[row]?.[column] ?? null,
					definition.percentRows.has(row) ||
						definition.percentColumns.has(column),
				),
			);
			lines.push(`| ${[row, ...values].join(" | ")} |`);
		}

		return `${lines.join("\n")}\n\n`;
	}

	private renderMarkdownRecords(
		definition: RecordDefinition,
		rows: RecordTableRow[],
		totalRow?: RecordTableRow,
	): string {
		const numericColumns = new Set(
			definition.columns.filter((column) =>
				this.isNumericRecordColumn(column, rows, totalRow),
			),
		);
		const lines = [
			`| ${definition.columns.join(" | ")} |`,
			`| ${definition.columns
				.map((column, index) =>
					index === 0 && !numericColumns.has(column) ? "---" : "---:",
				)
				.join(" | ")} |`,
		];

		for (const row of rows) {
			lines.push(
				`| ${definition.columns
					.map((column) =>
						this.formatRecordCell(
							row[column] ?? null,
							definition.percentColumns.has(column),
						),
					)
					.join(" | ")} |`,
			);
		}

		if (totalRow) {
			lines.push(
				`| ${definition.columns
					.map(
						(column) =>
							`**${this.formatRecordCell(
								totalRow[column] ?? null,
								definition.percentColumns.has(column),
							)}**`,
					)
					.join(" | ")} |`,
			);
		}

		return `${lines.join("\n")}\n\n`;
	}

	private formatNumericCell(
		value: NumericCellValue,
		isPercent: boolean,
	): string {
		if (value === null) {
			return "-";
		}
		return formatNumber(value, isPercent);
	}

	private formatRecordCell(value: RecordCellValue, isPercent: boolean): string {
		if (value === null) {
			return "-";
		}
		if (typeof value === "number") {
			return formatNumber(value, isPercent);
		}
		return value;
	}

	private isNumericRecordColumn(
		column: string,
		rows: RecordTableRow[],
		totalRow?: RecordTableRow,
	): boolean {
		const values = [
			...rows.map((row) => row[column]),
			totalRow ? totalRow[column] : undefined,
		].filter((value) => value !== undefined && value !== null);

		if (values.length === 0) {
			return false;
		}

		return values.every((value) => typeof value === "number");
	}
}
