import { StatusCodes } from "http-status-codes";
import { AinHttpError } from "@/types/agent.js";
import type {
	UserWorkflow,
	WorkflowDefinition,
	WorkflowVariable,
	WorkflowVariablePartSpec,
} from "@/types/memory.js";
import {
	resolveTemplateRecord,
	resolveTemplateString,
} from "@/utils/template-variables.js";

type WorkflowTextFields = Pick<
	UserWorkflow,
	| "title"
	| "content"
	| "timezone"
	| "variables"
	| "variableValues"
	| "definition"
>;

type VariableReplacement = {
	token: string;
	value: string;
	resolveAt: "creation" | "execution";
};

type ParsedDateValue = {
	year: string;
	month?: string;
	day?: string;
};

function getVariableTokens(key: string, variable?: WorkflowVariable): string[] {
	const tokens = [key];
	if (variable?.id && variable.id !== key) {
		tokens.push(variable.id);
	}
	return [...new Set(tokens)];
}

function normalizePartSpecs(
	parts?: WorkflowVariable["parts"],
): Array<{ token: string; format: string; source: "value" | "start" | "end" }> {
	if (!parts) {
		return [];
	}

	if (Array.isArray(parts)) {
		return parts
			.map((part) => {
				const token =
					part.token ||
					part.placeholder ||
					part.id ||
					part.key ||
					part.name ||
					part.label;
				if (!token) {
					return undefined;
				}

				return {
					token,
					format:
						part.format ||
						inferDatePartFormat(
							part.key || part.name || part.label || part.id || token,
						),
					source: part.source || "value",
				};
			})
			.filter(
				(
					part,
				): part is {
					token: string;
					format: string;
					source: "value" | "start" | "end";
				} => Boolean(part),
			);
	}

	return Object.entries(parts)
		.map(([partKey, tokenOrSpec]) => {
			if (typeof tokenOrSpec === "string") {
				if (!tokenOrSpec.trim()) {
					return undefined;
				}
				return {
					token: tokenOrSpec,
					format: inferDatePartFormat(partKey),
					source: inferDatePartSource(partKey),
				};
			}

			const spec = tokenOrSpec as WorkflowVariablePartSpec;
			const token =
				spec.token ||
				spec.placeholder ||
				spec.id ||
				spec.key ||
				spec.name ||
				spec.label;
			if (!token) {
				return undefined;
			}

			return {
				token,
				format: spec.format || inferDatePartFormat(partKey),
				source: spec.source || inferDatePartSource(partKey),
			};
		})
		.filter(
			(
				part,
			): part is {
				token: string;
				format: string;
				source: "value" | "start" | "end";
			} => Boolean(part?.token),
		);
}

function inferDatePartFormat(input: string): string {
	if (/year|년도|연도|yyyy/i.test(input)) {
		return "YYYY";
	}
	if (/month|월|mm/i.test(input)) {
		return "MM";
	}
	if (/day|일|dd/i.test(input)) {
		return "DD";
	}
	return "YYYY-MM-DD";
}

function inferDatePartSource(input: string): "value" | "start" | "end" {
	if (/^start/i.test(input)) {
		return "start";
	}
	if (/^end/i.test(input)) {
		return "end";
	}
	return "value";
}

function parseDateValue(
	value: string,
	source: "value" | "start" | "end",
): ParsedDateValue | undefined {
	const segments = value.split(/\s*~\s*/);
	const target =
		source === "start"
			? segments[0]
			: source === "end"
				? segments[segments.length - 1]
				: value;
	const match = target.trim().match(/(\d{4})[-/.]?(\d{2})?[-/.]?(\d{2})?/);
	if (!match) {
		return undefined;
	}

	return {
		year: match[1],
		month: match[2],
		day: match[3],
	};
}

function formatParsedDateValue(
	dateValue: ParsedDateValue,
	format: string,
): string {
	return format
		.replace("YYYY", dateValue.year)
		.replace("YY", dateValue.year.slice(-2))
		.replace("MM", dateValue.month || "")
		.replace("M", dateValue.month ? String(Number(dateValue.month)) : "")
		.replace("DD", dateValue.day || "")
		.replace("D", dateValue.day ? String(Number(dateValue.day)) : "");
}

function buildVariableReplacements(
	variableValues: Record<string, string>,
	variables?: WorkflowTextFields["variables"],
): VariableReplacement[] {
	const replacements: VariableReplacement[] = [];

	for (const [key, variableValue] of Object.entries(variableValues)) {
		const variable = variables?.[key];
		const resolveAt = variable?.resolveAt ?? "creation";

		for (const token of getVariableTokens(key, variable)) {
			replacements.push({ token, value: variableValue, resolveAt });
		}

		if (variable?.type !== "date_parts") {
			continue;
		}

		for (const part of normalizePartSpecs(variable.parts)) {
			const parsedDateValue = parseDateValue(variableValue, part.source);
			if (!parsedDateValue) {
				continue;
			}

			replacements.push({
				token: part.token,
				value: formatParsedDateValue(parsedDateValue, part.format),
				resolveAt,
			});
		}
	}

	return replacements;
}

function applyReplacements(
	input: string,
	replacements: VariableReplacement[],
	resolveAt: "creation" | "execution",
): string {
	const scopedReplacements = replacements.filter(
		(replacement) => replacement.resolveAt === resolveAt,
	);

	return scopedReplacements.reduce((result, replacement) => {
		const withOffsets = replaceOffsetExpressions(result, replacement);
		return withOffsets.replaceAll(
			`{{${replacement.token}}}`,
			replacement.value,
		);
	}, input);
}

function replaceOffsetExpressions(
	input: string,
	replacement: VariableReplacement,
): string {
	const pattern = new RegExp(
		`\\{\\{(${escapeRegExp(replacement.token)})([+-]\\d+)\\}\\}`,
		"g",
	);

	return input.replace(pattern, (match, _token, rawOffset: string) => {
		const offset = Number.parseInt(rawOffset, 10);
		const resolved = applyNumericOffset(replacement.value, offset);
		return resolved ?? match;
	});
}

function applyNumericOffset(value: string, offset: number): string | undefined {
	const trimmed = value.trim();
	if (!/^-?\d+$/.test(trimmed)) {
		return undefined;
	}

	const nextValue = Number.parseInt(trimmed, 10) + offset;
	if (!Number.isFinite(nextValue)) {
		return undefined;
	}

	const isNegative = nextValue < 0;
	const digits = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
	const preserveWidth = /^0\d+$/.test(digits);
	if (!preserveWidth) {
		return nextValue.toString();
	}

	return `${isNegative ? "-" : ""}${Math.abs(nextValue)
		.toString()
		.padStart(digits.length, "0")}`;
}

function escapeRegExp(input: string): string {
	return input.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWorkflowVariablesInValue(
	value: unknown,
	replacements: VariableReplacement[],
	resolveAt: "creation" | "execution",
): unknown {
	if (typeof value === "string") {
		return applyReplacements(value, replacements, resolveAt);
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			replaceWorkflowVariablesInValue(item, replacements, resolveAt),
		);
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				replaceWorkflowVariablesInValue(item, replacements, resolveAt),
			]),
		);
	}

	return value;
}

function resolveWorkflowVariables(
	input: string,
	replacements: VariableReplacement[],
	resolveAt: "creation" | "execution",
): string {
	return applyReplacements(input, replacements, resolveAt);
}

function validateWorkflowDefinition(
	definition?: WorkflowDefinition,
): WorkflowDefinition | undefined {
	if (!definition) {
		return undefined;
	}

	if (!Array.isArray(definition.tasks)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Workflow definition.tasks must be an array.",
		);
	}

	if (!Array.isArray(definition.response?.blocks)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Workflow definition.response.blocks must be an array.",
		);
	}

	for (const block of definition.response.blocks) {
		if (block.type === "heading") {
			if (typeof block.text !== "string" || !block.text.trim()) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Heading block "${block.blockId}" must use a non-empty text string.`,
				);
			}

			if (
				block.level !== undefined &&
				block.level !== 1 &&
				block.level !== 2 &&
				block.level !== 3
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Heading block "${block.blockId}" level must be 1, 2, or 3.`,
				);
			}

			continue;
		}

		if (
			block.type === "text" &&
			block.sourceBlockIds &&
			(!Array.isArray(block.sourceBlockIds) ||
				block.sourceBlockIds.some((blockId) => typeof blockId !== "string"))
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Text block "${block.blockId}" must use sourceBlockIds: string[].`,
			);
		}

		if (block.type === "graph") {
			const graphType = (block as { graphType?: unknown }).graphType;
			if (graphType !== "xychart-beta" && graphType !== "pie") {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" must declare graphType as "xychart-beta" or "pie".`,
				);
			}

			if (typeof block.prompt !== "string" || !block.prompt.trim()) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" must use a non-empty prompt string.`,
				);
			}

			if (block.title !== undefined && typeof block.title !== "string") {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" title must be a string.`,
				);
			}

			if (
				block.sourceTaskIds &&
				(!Array.isArray(block.sourceTaskIds) ||
					block.sourceTaskIds.some((taskId) => typeof taskId !== "string"))
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" must use sourceTaskIds: string[].`,
				);
			}

			if (
				block.sourceBlockIds &&
				(!Array.isArray(block.sourceBlockIds) ||
					block.sourceBlockIds.some((blockId) => typeof blockId !== "string"))
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" must use sourceBlockIds: string[].`,
				);
			}

			if (
				block.graphType === "pie" &&
				block.showData !== undefined &&
				typeof block.showData !== "boolean"
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Graph block "${block.blockId}" showData must be boolean.`,
				);
			}

			continue;
		}

		if (block.type !== "table") {
			continue;
		}

		if (block.layout !== "records" && block.layout !== "matrix") {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Table block "${block.blockId}" must declare layout as "records" or "matrix".`,
			);
		}

		if (
			!Array.isArray(block.columns) ||
			block.columns.length === 0 ||
			block.columns.some((column) => typeof column !== "string")
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Table block "${block.blockId}" must use columns: string[].`,
			);
		}

		if (
			block.layout === "matrix" &&
			(!Array.isArray(block.rows) ||
				block.rows.length === 0 ||
				block.rows.some((row) => typeof row !== "string"))
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Matrix table block "${block.blockId}" must use rows: string[].`,
			);
		}

		if (
			block.formulas &&
			(!Array.isArray(block.formulas) ||
				block.formulas.some((formula) => typeof formula !== "string"))
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Table block "${block.blockId}" must use formulas: string[].`,
			);
		}

		for (const key of ["hiddenRows", "hiddenColumns"] as const) {
			const value = block[key];
			if (
				value &&
				(!Array.isArray(value) ||
					value.some((item) => typeof item !== "string"))
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Table block "${block.blockId}" must use ${key}: string[].`,
				);
			}
		}

		if (
			block.columnFormats &&
			(typeof block.columnFormats !== "object" ||
				Array.isArray(block.columnFormats))
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Table block "${block.blockId}" must use columnFormats: Record<string, object>.`,
			);
		}

		for (const [column, format] of Object.entries(block.columnFormats || {})) {
			if (!format || typeof format !== "object" || Array.isArray(format)) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Table block "${block.blockId}" columnFormats.${column} must be an object.`,
				);
			}

			if (
				format.kind &&
				!["auto", "text", "number", "currency", "percent"].includes(
					String(format.kind),
				)
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Table block "${block.blockId}" columnFormats.${column}.kind is invalid.`,
				);
			}

			if (
				format.grouping !== undefined &&
				typeof format.grouping !== "boolean"
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Table block "${block.blockId}" columnFormats.${column}.grouping must be boolean.`,
				);
			}

			if (
				format.decimals !== undefined &&
				(typeof format.decimals !== "number" ||
					!Number.isFinite(format.decimals))
			) {
				throw new AinHttpError(
					StatusCodes.BAD_REQUEST,
					`Table block "${block.blockId}" columnFormats.${column}.decimals must be a number.`,
				);
			}

			for (const key of ["prefix", "suffix", "nullDisplay"] as const) {
				const value = format[key];
				if (value !== undefined && typeof value !== "string") {
					throw new AinHttpError(
						StatusCodes.BAD_REQUEST,
						`Table block "${block.blockId}" columnFormats.${column}.${key} must be a string.`,
					);
				}
			}
		}

		if (
			block.sourceTaskIds &&
			(!Array.isArray(block.sourceTaskIds) ||
				block.sourceTaskIds.some((taskId) => typeof taskId !== "string"))
		) {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				`Table block "${block.blockId}" must use sourceTaskIds: string[].`,
			);
		}
	}

	return definition;
}

function normalizeVariableType(
	type: WorkflowVariable["type"],
): WorkflowVariable["type"] {
	return type === "dropdown" ? "select" : type;
}

function normalizeWorkflowVariablesRecord(
	variables?: Record<string, WorkflowVariable>,
): Record<string, WorkflowVariable> | undefined {
	if (!variables) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(variables).map(([key, variable]) => [
			key,
			{
				...variable,
				type: normalizeVariableType(variable.type),
			},
		]),
	);
}

function resolveTemplateValue(value: unknown, timezone?: string): unknown {
	if (typeof value === "string") {
		return resolveTemplateString(value, timezone);
	}

	if (Array.isArray(value)) {
		return value.map((item) => resolveTemplateValue(item, timezone));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				resolveTemplateValue(item, timezone),
			]),
		);
	}

	return value;
}

export class WorkflowVariableResolver {
	normalizeDefinition(
		definition?: WorkflowDefinition,
	): WorkflowDefinition | undefined {
		return validateWorkflowDefinition(definition);
	}

	normalizeVariables(
		variables?: Record<string, WorkflowVariable>,
	): Record<string, WorkflowVariable> | undefined {
		return normalizeWorkflowVariablesRecord(variables);
	}

	resolveForCreation(workflow: WorkflowTextFields): {
		content: string;
		title: string;
		definition?: WorkflowDefinition;
	} {
		let { content, title } = workflow;
		let { definition } = workflow;
		const normalizedVariables = normalizeWorkflowVariablesRecord(
			workflow.variables,
		);

		if (!workflow.variableValues || !normalizedVariables) {
			return {
				content,
				title,
				definition: validateWorkflowDefinition(definition),
			};
		}

		const replacements = buildVariableReplacements(
			workflow.variableValues,
			normalizedVariables,
		);

		content = resolveWorkflowVariables(content, replacements, "creation");
		title = resolveWorkflowVariables(title, replacements, "creation");

		definition = replaceWorkflowVariablesInValue(
			definition,
			replacements,
			"creation",
		) as WorkflowDefinition | undefined;

		return {
			content,
			title,
			definition: validateWorkflowDefinition(definition),
		};
	}

	resolveForExecution(
		workflow: WorkflowTextFields,
		executionVariables?: Record<string, string>,
	): {
		query: string;
		displayQuery: string;
		definition?: WorkflowDefinition;
	} {
		const { timezone } = workflow;
		let query = workflow.content;
		let displayQuery = workflow.title;
		let definition = workflow.definition;
		const normalizedVariables = normalizeWorkflowVariablesRecord(
			workflow.variables,
		);
		const mergedExecutionVariables = {
			...(workflow.variableValues || {}),
			...(executionVariables || {}),
		};

		if (Object.keys(mergedExecutionVariables).length > 0) {
			const resolvedVars = resolveTemplateRecord(
				mergedExecutionVariables,
				timezone,
			);
			const replacements = buildVariableReplacements(
				resolvedVars,
				normalizedVariables,
			);
			query = resolveWorkflowVariables(query, replacements, "execution");
			displayQuery = resolveWorkflowVariables(
				displayQuery,
				replacements,
				"execution",
			);
			definition = replaceWorkflowVariablesInValue(
				definition,
				replacements,
				"execution",
			) as WorkflowDefinition | undefined;
		}

		return {
			query: resolveTemplateString(query, timezone),
			displayQuery: resolveTemplateString(displayQuery, timezone),
			definition: validateWorkflowDefinition(
				resolveTemplateValue(definition, timezone) as
					| WorkflowDefinition
					| undefined,
			),
		};
	}
}
