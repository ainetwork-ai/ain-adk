import type {
	WorkflowRenderedTableData,
	WorkflowTableColumnFormat,
	WorkflowTableColumnFormatKind,
} from "@/types/memory.js";

export type NumericCellValue = number | null;
export type RecordCellValue = string | number | null;
export type RecordTableRow = Record<string, RecordCellValue>;
export type MatrixTable = Record<string, Record<string, NumericCellValue>>;

export type ParsedMatrixFormula =
	| {
			raw: string;
			target: string;
			type: "col_sum";
			args: string[];
	  }
	| {
			raw: string;
			target: string;
			type: "row_sum";
			args: string[];
	  }
	| {
			raw: string;
			target: string;
			type: "row_share";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "row_ratio";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "row_delta" | "row_rate" | "row_growth";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "col_share";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "col_ratio";
			args: [string, string];
	  }
	| {
			raw: string;
			target: string;
			type: "col_delta" | "col_rate" | "col_growth";
			args: [string, string];
	  };

export type RecordExpressionOperand =
	| { kind: "column"; name: string }
	| { kind: "number"; value: number };

export type ParsedRecordFormula =
	| {
			raw: string;
			type: "expression";
			target: string;
			operands: RecordExpressionOperand[];
			operators: Array<"+" | "-" | "*" | "/">;
	  }
	| {
			raw: string;
			type: "sum";
			target: string;
			columns: string[];
	  }
	| {
			raw: string;
			type: "total";
			columns: string[];
	  };

export type MatrixDefinition = {
	layout: "matrix";
	rowHeader: string;
	rows: string[];
	visibleRows: string[];
	columns: string[];
	visibleColumns: string[];
	columnFormats: Record<string, WorkflowTableColumnFormat>;
	sourceRows: string[];
	sourceColumns: string[];
	computedRowTargets: Set<string>;
	computedColumnTargets: Set<string>;
	comparisonRowTargets: Set<string>;
	comparisonColumnTargets: Set<string>;
	percentRows: Set<string>;
	percentColumns: Set<string>;
	formulas: ParsedMatrixFormula[];
};

export type RecordDefinition = {
	layout: "records";
	columns: string[];
	visibleColumns: string[];
	columnFormats: Record<string, WorkflowTableColumnFormat>;
	sourceColumns: string[];
	computedColumns: Set<string>;
	percentColumns: Set<string>;
	formulas: ParsedRecordFormula[];
	totalFormula?: Extract<ParsedRecordFormula, { type: "total" }>;
};

export type WorkflowTableDefinition = MatrixDefinition | RecordDefinition;

export type WorkflowTableRenderResult = {
	content: string;
	data: WorkflowRenderedTableData;
};

export type ResolvedColumnFormat = {
	kind: WorkflowTableColumnFormatKind;
	grouping: boolean;
	/** undefined = preserve the value's own decimal precision (capped). */
	decimals: number | undefined;
	prefix: string;
	suffix: string;
	nullDisplay: string;
};

export type MatrixCellRef = `${string}::${string}`;

export function isFiniteNumber(value: unknown): value is number {
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

function normalizeTextIdentifierString(value: string): string {
	const trimmed = value.trim();
	if (/^\d[\d,]*$/.test(trimmed)) {
		return trimmed.replace(/,/g, "");
	}
	return trimmed;
}

export function parseNumberish(value: unknown): NumericCellValue {
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

export function parseRecordCell(
	value: unknown,
	format?: WorkflowTableColumnFormat,
): RecordCellValue {
	if (value === null || value === undefined || value === "") {
		return null;
	}

	if (format?.kind === "text") {
		return typeof value === "string"
			? normalizeTextIdentifierString(value)
			: String(value);
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

/**
 * Fraction digits cap when a column declares no explicit `decimals`: enough to
 * keep source precision (values parsed from text round-trip exactly), while
 * cutting binary float noise from formula-computed cells (100/3 → "33.3333").
 */
const MAX_INFERRED_FRACTION_DIGITS = 4;

function inferFractionDigits(value: number): number {
	const fraction = String(value).split(".")[1] ?? "";
	return Math.min(fraction.length, MAX_INFERRED_FRACTION_DIGITS);
}

export function formatNumber(
	value: number,
	options: { grouping: boolean; decimals: number | undefined },
): string {
	return value.toLocaleString("en-US", {
		useGrouping: options.grouping,
		minimumFractionDigits: 0,
		maximumFractionDigits: options.decimals ?? inferFractionDigits(value),
	});
}

export function safeDivide(
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

export function looksPercentLike(value: string): boolean {
	return /%|Pct|Growth/i.test(value);
}
