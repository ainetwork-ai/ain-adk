import {
	formatNumber,
	type MatrixDefinition,
	type MatrixTable,
	type NumericCellValue,
	type RecordCellValue,
	type RecordDefinition,
	type RecordTableRow,
	type ResolvedColumnFormat,
	type WorkflowTableRenderResult,
} from "@/services/workflow-table/shared.js";
import type {
	WorkflowRenderedTableData,
	WorkflowTableBlock,
	WorkflowTableColumnFormat,
	WorkflowTableColumnFormatKind,
} from "@/types/memory.js";

export class WorkflowTableRenderer {
	renderMatrix(
		block: WorkflowTableBlock,
		definition: MatrixDefinition,
		matrix: MatrixTable,
		warnings: string[],
	): WorkflowTableRenderResult {
		return {
			content: this.renderMarkdownMatrix(definition, matrix),
			data: this.buildMatrixRenderedData(block, definition, matrix, warnings),
		};
	}

	renderRecords(
		block: WorkflowTableBlock,
		definition: RecordDefinition,
		rows: RecordTableRow[],
		totalRow: RecordTableRow | undefined,
		warnings: string[],
	): WorkflowTableRenderResult {
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
				columnFormats: definition.columnFormats,
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
				columnFormats: definition.columnFormats,
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
					definition.columnFormats[column],
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
			definition.columns.filter((column) => {
				if (definition.columnFormats[column]?.kind === "text") {
					return false;
				}
				return this.isNumericRecordColumn(column, rows, totalRow);
			}),
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
							definition.columnFormats[column],
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
								definition.columnFormats[column],
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
		columnFormat: WorkflowTableColumnFormat | undefined,
		isPercent: boolean,
	): string {
		return this.formatNumericValue(value, columnFormat, isPercent);
	}

	private formatRecordCell(
		value: RecordCellValue,
		columnFormat: WorkflowTableColumnFormat | undefined,
		isPercent: boolean,
	): string {
		if (value === null) {
			return this.resolveColumnFormat(columnFormat, isPercent).nullDisplay;
		}
		const resolvedFormat = this.resolveColumnFormat(columnFormat, isPercent);
		if (resolvedFormat.kind === "text") {
			return String(value);
		}
		if (typeof value === "number") {
			return this.formatNumericValue(value, columnFormat, isPercent);
		}
		return value;
	}

	private formatNumericValue(
		value: NumericCellValue,
		columnFormat: WorkflowTableColumnFormat | undefined,
		isPercent: boolean,
	): string {
		const resolvedFormat = this.resolveColumnFormat(columnFormat, isPercent);
		if (value === null) {
			return resolvedFormat.nullDisplay;
		}

		const formatted = formatNumber(value, {
			grouping: resolvedFormat.grouping,
			decimals: resolvedFormat.decimals,
		});
		return `${resolvedFormat.prefix}${formatted}${resolvedFormat.suffix}`;
	}

	private resolveColumnFormat(
		columnFormat: WorkflowTableColumnFormat | undefined,
		isPercent: boolean,
	): ResolvedColumnFormat {
		const kind =
			columnFormat?.kind && columnFormat.kind !== "auto"
				? columnFormat.kind
				: isPercent
					? "percent"
					: "number";

		const defaults: Record<
			Exclude<WorkflowTableColumnFormatKind, "auto">,
			Omit<ResolvedColumnFormat, "kind">
		> = {
			text: {
				grouping: false,
				decimals: 0,
				prefix: "",
				suffix: "",
				nullDisplay: "-",
			},
			number: {
				grouping: true,
				decimals: 0,
				prefix: "",
				suffix: "",
				nullDisplay: "-",
			},
			currency: {
				grouping: true,
				decimals: 0,
				prefix: "",
				suffix: "",
				nullDisplay: "-",
			},
			percent: {
				grouping: false,
				decimals: 1,
				prefix: "",
				suffix: "%",
				nullDisplay: "-",
			},
		};

		const fallback = defaults[kind];
		return {
			kind,
			grouping: columnFormat?.grouping ?? fallback.grouping,
			decimals: columnFormat?.decimals ?? fallback.decimals,
			prefix: columnFormat?.prefix ?? fallback.prefix,
			suffix: columnFormat?.suffix ?? fallback.suffix,
			nullDisplay: columnFormat?.nullDisplay ?? fallback.nullDisplay,
		};
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
