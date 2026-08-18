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
			if (formula.type === "expression") {
				this.applyRecordExpressionFormula(formula, rows, warnings);
				continue;
			}
			if (formula.type === "sum") {
				this.applyRecordSumFormula(formula, rows);
			}
		}

		let totalRow: RecordTableRow | undefined;
		if (definition.totalFormula) {
			totalRow = this.buildRecordTotalRow(definition, rows);
			const totalIndex = definition.formulas.findIndex(
				(formula) => formula.type === "total",
			);
			const postTotalFormulas = definition.formulas.slice(totalIndex + 1);
			for (const formula of postTotalFormulas) {
				if (formula.type === "expression") {
					this.applyRecordExpressionFormula(formula, [totalRow], warnings);
					continue;
				}
				if (formula.type === "sum") {
					this.applyRecordSumFormula(formula, [totalRow]);
				}
			}
		}

		return { rows, totalRow, warnings };
	}

	private validateRecordFormulaDependencies(
		definition: RecordDefinition,
	): void {
		const computedFormulas = definition.formulas.filter(
			(formula): formula is Exclude<ParsedRecordFormula, { type: "total" }> =>
				formula.type !== "total",
		);
		const available = new Set(definition.sourceColumns);
		const producedByFormula = computedFormulas.map((formula) => formula.target);

		for (const [index, formula] of computedFormulas.entries()) {
			const futureProduced = new Set(producedByFormula.slice(index + 1));
			const referencedColumns =
				formula.type === "expression"
					? formula.operands
							.filter(
								(operand): operand is { kind: "column"; name: string } =>
									operand.kind === "column",
							)
							.map((operand) => operand.name)
					: formula.columns;
			const laterColumns = referencedColumns.filter(
				(column) => !available.has(column) && futureProduced.has(column),
			);
			if (laterColumns.length > 0) {
				throw new Error(
					`Record formula "${formula.raw}" depends on values from later formulas: ${laterColumns.join(", ")}`,
				);
			}

			const missingColumns = referencedColumns.filter(
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
		const initialAvailable = this.buildInitialMatrixAvailability(definition);

		const producedByFormula: Set<MatrixCellRef>[] = [];
		const projectedAvailable = new Set(initialAvailable);
		for (const formula of definition.formulas) {
			const refs = this.getMatrixProducedRefs(
				formula,
				definition,
				projectedAvailable,
			);
			producedByFormula.push(refs);
			for (const ref of refs) {
				projectedAvailable.add(ref);
			}
		}

		const available = new Set(initialAvailable);
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
		available: Set<MatrixCellRef>,
	): Set<MatrixCellRef> {
		switch (formula.type) {
			case "col_sum":
				return new Set(
					definition.rows
						.filter((row) =>
							formula.args.every((column) =>
								available.has(this.toMatrixCellRef(row, column)),
							),
						)
						.map((row) => this.toMatrixCellRef(row, formula.target)),
				);
			case "row_sum":
				return new Set(
					definition.columns
						.filter(
							(column) =>
								!definition.comparisonColumnTargets.has(column) &&
								formula.args.every((row) =>
									available.has(this.toMatrixCellRef(row, column)),
								),
						)
						.map((column) => this.toMatrixCellRef(formula.target, column)),
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
			case "col_share": {
				const [, baseRow] = formula.args;
				const baseIndex = definition.rows.indexOf(baseRow);
				if (baseIndex === -1) {
					throw new Error(`Invalid col_share formula: ${formula.raw}`);
				}
				return new Set(
					definition.rows
						.filter(
							(row, index) =>
								index <= baseIndex && !definition.comparisonRowTargets.has(row),
						)
						.map((row) => this.toMatrixCellRef(row, formula.target)),
				);
			}
			case "col_ratio":
				return new Set(
					definition.rows
						.filter((row) => !definition.comparisonRowTargets.has(row))
						.map((row) => this.toMatrixCellRef(row, formula.target)),
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
			case "row_sum":
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.sourceColumns.flatMap((column) =>
						formula.args.map((row) => this.toMatrixCellRef(row, column)),
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
			case "col_share": {
				const [sourceColumn, baseRow] = formula.args;
				const baseIndex = definition.rows.indexOf(baseRow);
				if (baseIndex === -1 || !definition.columns.includes(sourceColumn)) {
					throw new Error(`Invalid col_share formula: ${formula.raw}`);
				}
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.rows
						.filter(
							(row, index) =>
								index <= baseIndex && !definition.comparisonRowTargets.has(row),
						)
						.map((row) => this.toMatrixCellRef(row, sourceColumn)),
					available,
					futureProduced,
				);
				return;
			}
			case "col_ratio": {
				const [numeratorColumn, denominatorColumn] = formula.args;
				this.assertMatrixRefsAvailable(
					formula.raw,
					definition.rows
						.filter((row) => !definition.comparisonRowTargets.has(row))
						.flatMap((row) => [
							this.toMatrixCellRef(row, numeratorColumn),
							this.toMatrixCellRef(row, denominatorColumn),
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
				for (const row of definition.rows) {
					const values = formula.args.map(
						(column) => matrix[row]?.[column] ?? null,
					);
					if (values.every((value) => value === null)) {
						continue;
					}
					matrix[row][formula.target] = values.reduce<number>(
						(sum, value) => sum + (value ?? 0),
						0,
					);
				}
				return;
			case "row_sum":
				for (const column of definition.columns) {
					if (definition.comparisonColumnTargets.has(column)) {
						continue;
					}
					const isSourceColumn = definition.sourceColumns.includes(column);
					const values = formula.args.map(
						(row) => matrix[row]?.[column] ?? null,
					);
					if (!isSourceColumn && values.every((value) => value === null)) {
						continue;
					}
					matrix[formula.target][column] = values.reduce<number>(
						(sum, value) => sum + (value ?? 0),
						0,
					);
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
			case "col_share":
				this.applyMatrixColShareFormula(formula, definition, matrix, warnings);
				return;
			case "col_ratio":
				this.applyMatrixColRatioFormula(formula, definition, matrix, warnings);
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

	private applyMatrixColShareFormula(
		formula: Extract<ParsedMatrixFormula, { type: "col_share" }>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [sourceColumn, baseRow] = formula.args;
		const baseIndex = definition.rows.indexOf(baseRow);
		if (baseIndex === -1 || !matrix[baseRow]) {
			throw new Error(`Invalid col_share formula: ${formula.raw}`);
		}

		const baseValue = matrix[baseRow][sourceColumn];
		for (const [index, row] of definition.rows.entries()) {
			if (index > baseIndex || definition.comparisonRowTargets.has(row)) {
				matrix[row][formula.target] = null;
				continue;
			}

			matrix[row][formula.target] = safeDivide(
				matrix[row]?.[sourceColumn] ?? null,
				baseValue,
				warnings,
				`${formula.target}.${row}`,
				100,
			);
		}
	}

	private applyMatrixColRatioFormula(
		formula: Extract<ParsedMatrixFormula, { type: "col_ratio" }>,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): void {
		const [numeratorColumn, denominatorColumn] = formula.args;
		for (const row of definition.rows) {
			if (definition.comparisonRowTargets.has(row)) {
				matrix[row][formula.target] = null;
				continue;
			}

			matrix[row][formula.target] = safeDivide(
				matrix[row]?.[numeratorColumn] ?? null,
				matrix[row]?.[denominatorColumn] ?? null,
				warnings,
				`${formula.target}.${row}`,
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

	private applyRecordExpressionFormula(
		formula: Extract<ParsedRecordFormula, { type: "expression" }>,
		rows: RecordTableRow[],
		warnings: string[],
	): void {
		for (const row of rows) {
			const values = formula.operands.map((operand) =>
				operand.kind === "column"
					? parseNumberish(row[operand.name])
					: operand.value,
			);
			row[formula.target] = this.evaluateRecordExpression(
				values,
				formula.operators,
				warnings,
				formula.target,
			);
		}
	}

	private evaluateRecordExpression(
		values: Array<number | null>,
		operators: Array<"+" | "-" | "*" | "/">,
		warnings: string[],
		context: string,
	): number | null {
		const valueStack: Array<number | null> = [values[0] ?? null];
		const operatorStack: Array<"+" | "-" | "*" | "/"> = [];

		for (const [index, operator] of operators.entries()) {
			while (
				operatorStack.length > 0 &&
				this.getRecordOperatorPrecedence(
					operatorStack[operatorStack.length - 1],
				) >= this.getRecordOperatorPrecedence(operator)
			) {
				this.reduceRecordExpression(
					valueStack,
					operatorStack,
					warnings,
					context,
				);
			}

			operatorStack.push(operator);
			valueStack.push(values[index + 1] ?? null);
		}

		while (operatorStack.length > 0) {
			this.reduceRecordExpression(valueStack, operatorStack, warnings, context);
		}

		return valueStack[0] ?? null;
	}

	private reduceRecordExpression(
		valueStack: Array<number | null>,
		operatorStack: Array<"+" | "-" | "*" | "/">,
		warnings: string[],
		context: string,
	): void {
		const operator = operatorStack.pop();
		const right = valueStack.pop();
		const left = valueStack.pop();
		if (operator === undefined || left === undefined || right === undefined) {
			throw new Error("Invalid record formula evaluation state.");
		}

		switch (operator) {
			case "+":
				valueStack.push(left === null || right === null ? null : left + right);
				return;
			case "-":
				valueStack.push(left === null || right === null ? null : left - right);
				return;
			case "*":
				valueStack.push(left === null || right === null ? null : left * right);
				return;
			case "/":
				valueStack.push(safeDivide(left, right, warnings, context));
				return;
		}
	}

	private getRecordOperatorPrecedence(operator: "+" | "-" | "*" | "/"): number {
		return operator === "*" || operator === "/" ? 2 : 1;
	}

	private applyRecordSumFormula(
		formula: Extract<ParsedRecordFormula, { type: "sum" }>,
		rows: RecordTableRow[],
	): void {
		for (const row of rows) {
			const values = formula.columns.map((column) =>
				parseNumberish(row[column]),
			);
			row[formula.target] = values.every((value) => value === null)
				? null
				: values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
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
