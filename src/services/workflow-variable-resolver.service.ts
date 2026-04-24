import { StatusCodes } from "http-status-codes";
import { AinHttpError } from "@/types/agent.js";
import type { UserWorkflow, WorkflowDefinition } from "@/types/memory.js";
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

function replaceWorkflowVariablesInValue(
	value: unknown,
	variableValues: Record<string, string>,
	resolveAt: "creation" | "execution",
	variables?: WorkflowTextFields["variables"],
): unknown {
	if (typeof value === "string") {
		let resolved = value;
		for (const [key, variableValue] of Object.entries(variableValues)) {
			const variable = variables?.[key];
			const variableResolveAt = variable?.resolveAt ?? "creation";
			if (variableResolveAt === resolveAt) {
				resolved = resolved.replaceAll(`{{${key}}}`, variableValue);
			}
		}
		return resolved;
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			replaceWorkflowVariablesInValue(
				item,
				variableValues,
				resolveAt,
				variables,
			),
		);
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				replaceWorkflowVariablesInValue(
					item,
					variableValues,
					resolveAt,
					variables,
				),
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

	resolveForCreation(workflow: WorkflowTextFields): {
		content: string;
		title: string;
		definition?: WorkflowDefinition;
	} {
		let { content, title } = workflow;
		let { definition } = workflow;

		if (!workflow.variableValues || !workflow.variables) {
			return {
				content,
				title,
				definition: validateWorkflowDefinition(definition),
			};
		}

		for (const [key, value] of Object.entries(workflow.variableValues)) {
			const variable = workflow.variables[key];
			const resolveAt = variable?.resolveAt ?? "creation";
			if (resolveAt === "creation") {
				content = content.replaceAll(`{{${key}}}`, value);
				title = title.replaceAll(`{{${key}}}`, value);
			}
		}

		definition = replaceWorkflowVariablesInValue(
			definition,
			workflow.variableValues,
			"creation",
			workflow.variables,
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
		const mergedExecutionVariables = {
			...(workflow.variableValues || {}),
			...(executionVariables || {}),
		};

		if (Object.keys(mergedExecutionVariables).length > 0) {
			const resolvedVars = resolveTemplateRecord(
				mergedExecutionVariables,
				timezone,
			);
			for (const [key, value] of Object.entries(resolvedVars)) {
				const variable = workflow.variables?.[key];
				const resolveAt = variable?.resolveAt ?? "creation";
				if (resolveAt === "execution") {
					query = query.replaceAll(`{{${key}}}`, value);
					displayQuery = displayQuery.replaceAll(`{{${key}}}`, value);
				}
			}
			definition = replaceWorkflowVariablesInValue(
				definition,
				resolvedVars,
				"execution",
				workflow.variables,
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
