import {
	type MatrixCellRef,
	type MatrixDefinition,
	type MatrixTable,
	type ParsedMatrixFormula,
	type ParsedRecordFormula,
	parseNumberish,
	parseRecordCell,
	type RecordDefinition,
	type RecordTableRow,
	safeDivide,
} from "@/services/workflow-table/shared.js";
import type { WorkflowTableColumnFormat } from "@/types/memory.js";

export class WorkflowTableFormulaEvaluator {
	evaluateMatrix(
		rawContent: string,
		definition: MatrixDefinition,
	): { matrix: MatrixTable; warnings: string[] } {
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

		this.applyMatrixFormulas(definition, matrix, warnings);
		return { matrix, warnings };
	}

	evaluateRecords(
		rawContent: string,
		definition: RecordDefinition,
	): {
		rows: RecordTableRow[];
		totalRow?: RecordTableRow;
		warnings: string[];
	} {
		this.validateRecordFormulaDependencies(definition);

		const warnings: string[] = [];
		const rows = this.parseRecordContent(
			rawContent,
			definition.sourceColumns,
			definition.columnFormats,
		);

		for (const formula of definition.formulas) {
			if (formula.type === "binary") {
				this.applyRecordBinaryFormula(formula, rows, warnings);
			}
		}

		return {
			rows,
			totalRow: definition.totalFormula
				? this.buildRecordTotalRow(definition, rows)
				: undefined,
			warnings,
		};
	}

	private validateRecordFormulaDependencies(
		definition: RecordDefinition,
	): void {
		const binaryFormulas = definition.formulas.filter(
			(formula): formula is Extract<ParsedRecordFormula, { type: "binary" }> =>
				formula.type === "binary",
		);
		const available = new Set(definition.sourceColumns);
		const producedByFormula = binaryFormulas.map((formula) => formula.target);

		for (const [index, formula] of binaryFormulas.entries()) {
			const futureProduced = new Set(producedByFormula.slice(index + 1));
			const laterColumns = [formula.left, formula.right].filter(
				(column) => !available.has(column) && futureProduced.has(column),
			);
			if (laterColumns.length > 0) {
				throw new Error(
					`Record formula "${formula.raw}" depends on values from later formulas: ${laterColumns.join(", ")}`,
				);
			}

			const missingColumns = [formula.left, formula.right].filter(
				(column) => !available.has(column) && !futureProduced.has(column),
			);
			if (missingColumns.length > 0) {
				throw new Error(
					`Record formula "${formula.raw}" references values that are never produced: ${missingColumns.join(", ")}`,
				);
			}

			available.add(formula.target);
		}
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
		columnFormats: Record<string, WorkflowTableColumnFormat>,
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
						parseRecordCell(item[column], columnFormats[column]),
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

	private applyMatrixFormulas(
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const available = this.buildInitialMatrixAvailability(definition);
		const producedByFormula = definition.formulas.map((formula) =>
			this.getMatrixProducedRefs(formula, definition),
		);

		for (const [index, formula] of definition.formulas.entries()) {
			const futureProduced = new Set<MatrixCellRef>(
				producedByFormula.slice(index + 1).flatMap((refs) => [...refs]),
			);
			this.validateMatrixFormulaDependencies(
				formula,
				definition,
				available,
				futureProduced,
			);
			this.applyMatrixFormula(formula, definition, matrix, warnings);
			for (const ref of producedByFormula[index]) {
				available.add(ref);
			}
		}
	}

	private buildInitialMatrixAvailability(
		definition: MatrixDefinition,
	): Set<MatrixCellRef> {
		const refs = new Set<MatrixCellRef>();
		for (const row of definition.sourceRows) {
			for (const column of definition.sourceColumns) {
				refs.add(this.toMatrixCellRef(row, column));
			}
		}
		return refs;
	}

	private getMatrixProducedRefs(
		formula: ParsedMatrixFormula,
		definition: MatrixDefinition,
	): Set<MatrixCellRef> {
		switch (formula.type) {
			case "col_sum":
				return new Set(
					definition.sourceRows.map((row) =>
						this.toMatrixCellRef(row, formula.target),
					),
				);
			case "row_share": {
				const [, baseColumn] = formula.args;
				const baseIndex = definition.columns.indexOf(baseColumn);
				if (baseIndex === -1) {
					throw new Error(`Invalid share formula: ${formula.raw}`);
				}
				return new Set(
					definition.columns
						.filter(
							(column, index) =>
								index <= baseIndex &&
								!definition.comparisonColumnTargets.has(column),
						)
						.map((column) => this.toMatrixCellRef(formula.target, column)),
				);
			}
			case "row_ratio":
			case "row_delta":
			case "row_rate":
			case "row_growth":
				return new Set(
					definition.columns
						.filter((column) => !definition.comparisonColumnTargets.has(column))
						.map((column) => this.toMatrixCellRef(formula.target, column)),
				);
			case "col_delta":
			case "col_rate":
			case "col_growth":
				return new Set(
					definition.rows.map((row) =>
						this.toMatrixCellRef(row, formula.target),
					),
				);
		}
	}

	private validateMatrixFormulaDependencies(
		formula: ParsedMatrixFormula,
		definition: MatrixDefinition,
		available: Set<MatrixCellRef>,
		futureProduced: Set<MatrixCellRef>,
	): void {
		switch (formula.type) {
			case "col_sum":
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.sourceRows.flatMap((row) =>
						formula.args.map((column) => this.toMatrixCellRef(row, column)),
					),
					available,
					futureProduced,
				);
				return;
			case "row_share": {
				const [sourceRow, baseColumn] = formula.args;
				const baseIndex = definition.columns.indexOf(baseColumn);
				if (baseIndex === -1 || !definition.rows.includes(sourceRow)) {
					throw new Error(`Invalid share formula: ${formula.raw}`);
				}
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.columns
						.filter(
							(column, index) =>
								index <= baseIndex &&
								!definition.comparisonColumnTargets.has(column),
						)
						.map((column) => this.toMatrixCellRef(sourceRow, column)),
					available,
					futureProduced,
				);
				return;
			}
			case "row_ratio":
			case "row_delta":
			case "row_rate":
			case "row_growth": {
				const [leftRow, rightRow] = formula.args;
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.columns
						.filter((column) => !definition.comparisonColumnTargets.has(column))
						.flatMap((column) => [
							this.toMatrixCellRef(leftRow, column),
							this.toMatrixCellRef(rightRow, column),
						]),
					available,
					futureProduced,
				);
				return;
			}
			case "col_delta":
			case "col_rate":
			case "col_growth": {
				const [leftColumn, rightColumn] = formula.args;
				const blockingRefs = definition.rows.flatMap((row) =>
					[leftColumn, rightColumn]
						.map((column) => this.toMatrixCellRef(row, column))
						.filter((ref) => !available.has(ref) && futureProduced.has(ref)),
				);
				if (blockingRefs.length > 0) {
					throw new Error(
						`Matrix formula "${formula.raw}" depends on values from later formulas: ${blockingRefs.join(", ")}`,
					);
				}
				return;
			}
		}
	}

	private assertMatrixRefsAvailable(
		formula: string,
		refs: MatrixCellRef[],
		available: Set<MatrixCellRef>,
		futureProduced: Set<MatrixCellRef>,
	): void {
		const laterRefs = refs.filter(
			(ref) => !available.has(ref) && futureProduced.has(ref),
		);
		if (laterRefs.length > 0) {
			throw new Error(
				`Matrix formula "${formula}" depends on values from later formulas: ${laterRefs.join(", ")}`,
			);
		}

		const missingRefs = refs.filter(
			(ref) => !available.has(ref) && !futureProduced.has(ref),
		);
		if (missingRefs.length > 0) {
			throw new Error(
				`Matrix formula "${formula}" references values that are never produced: ${missingRefs.join(", ")}`,
			);
		}
	}

	private toMatrixCellRef(row: string, column: string): MatrixCellRef {
		return `${row}::${column}`;
	}

	private applyMatrixFormula(
		formula: ParsedMatrixFormula,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		switch (formula.type) {
			case "col_sum":
				for (const row of definition.sourceRows) {
					const values = formula.args.map(
						(column) => matrix[row]?.[column] ?? null,
					);
					matrix[row][formula.target] = values.every((value) => value === null)
						? null
						: values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
				}
				return;
			case "row_share":
				this.applyMatrixShareFormula(formula, definition, matrix, warnings);
				return;
			case "row_ratio":
				this.applyMatrixRatioFormula(formula, definition, matrix, warnings);
				return;
			case "row_delta":
			case "row_rate":
			case "row_growth":
				this.applyMatrixRowComparisonFormula(
					formula,
					definition,
					matrix,
					warnings,
				);
				return;
			case "col_delta":
			case "col_rate":
			case "col_growth":
				this.applyMatrixColumnComparisonFormula(
					formula,
					definition,
					matrix,
					warnings,
				);
				return;
		}
	}

	private applyMatrixShareFormula(
		formula: Extract<ParsedMatrixFormula, { type: "row_share" }>,
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
		formula: Extract<ParsedMatrixFormula, { type: "row_ratio" }>,
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

	private applyMatrixRowComparisonFormula(
		formula: Extract<
			ParsedMatrixFormula,
			{ type: "row_delta" | "row_rate" | "row_growth" }
		>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [leftRow, rightRow] = formula.args;
		if (!matrix[leftRow] || !matrix[rightRow]) {
			throw new Error(`Invalid ${formula.type} formula: ${formula.raw}`);
		}

		for (const column of definition.columns) {
			if (definition.comparisonColumnTargets.has(column)) {
				matrix[formula.target][column] = null;
				continue;
			}

			const leftValue = matrix[leftRow][column];
			const rightValue = matrix[rightRow][column];

			switch (formula.type) {
				case "row_delta":
					matrix[formula.target][column] =
						leftValue === null || rightValue === null
							? null
							: leftValue - rightValue;
					break;
				case "row_rate":
					matrix[formula.target][column] = safeDivide(
						leftValue,
						rightValue,
						warnings,
						`${formula.target}.${column}`,
						100,
					);
					break;
				case "row_growth":
					if (leftValue === null || rightValue === null) {
						matrix[formula.target][column] = null;
						break;
					}
					matrix[formula.target][column] = safeDivide(
						leftValue - rightValue,
						rightValue,
						warnings,
						`${formula.target}.${column}`,
						100,
					);
					break;
			}
		}
	}

	private applyMatrixColumnComparisonFormula(
		formula: Extract<
			ParsedMatrixFormula,
			{ type: "col_delta" | "col_rate" | "col_growth" }
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
				case "col_delta":
					matrix[row][formula.target] =
						leftValue === null || rightValue === null
							? null
							: leftValue - rightValue;
					break;
				case "col_rate":
					matrix[row][formula.target] = safeDivide(
						leftValue,
						rightValue,
						warnings,
						`${row}.${formula.target}`,
						100,
					);
					break;
				case "col_growth":
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
			let result = null;

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
}
