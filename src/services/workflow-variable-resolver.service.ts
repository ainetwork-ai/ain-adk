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
	resolveForCreation(workflow: WorkflowTextFields): {
		content: string;
		title: string;
		definition?: WorkflowDefinition;
	} {
		let { content, title } = workflow;
		let { definition } = workflow;

		if (!workflow.variableValues || !workflow.variables) {
			return { content, title, definition };
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

		return { content, title, definition };
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

		if (executionVariables) {
			const resolvedVars = resolveTemplateRecord(executionVariables, timezone);
			for (const [key, value] of Object.entries(resolvedVars)) {
				query = query.replaceAll(`{{${key}}}`, value);
				displayQuery = displayQuery.replaceAll(`{{${key}}}`, value);
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
			definition: resolveTemplateValue(definition, timezone) as
				| WorkflowDefinition
				| undefined,
		};
	}
}
