import type { UserWorkflow } from "@/types/memory.js";
import {
	resolveTemplateRecord,
	resolveTemplateString,
} from "@/utils/template-variables.js";

type WorkflowTextFields = Pick<
	UserWorkflow,
	"title" | "content" | "timezone" | "variables" | "variableValues"
>;

export class WorkflowVariableResolver {
	resolveForCreation(workflow: WorkflowTextFields): {
		content: string;
		title: string;
	} {
		let { content, title } = workflow;

		if (!workflow.variableValues || !workflow.variables) {
			return { content, title };
		}

		for (const [key, value] of Object.entries(workflow.variableValues)) {
			const variable = workflow.variables[key];
			const resolveAt = variable?.resolveAt ?? "creation";
			if (resolveAt === "creation") {
				content = content.replaceAll(`{{${key}}}`, value);
				title = title.replaceAll(`{{${key}}}`, value);
			}
		}

		return { content, title };
	}

	resolveForExecution(
		workflow: WorkflowTextFields,
		executionVariables?: Record<string, string>,
	): {
		query: string;
		displayQuery: string;
	} {
		const { timezone } = workflow;
		let query = workflow.content;
		let displayQuery = workflow.title;

		if (executionVariables) {
			const resolvedVars = resolveTemplateRecord(executionVariables, timezone);
			for (const [key, value] of Object.entries(resolvedVars)) {
				query = query.replaceAll(`{{${key}}}`, value);
				displayQuery = displayQuery.replaceAll(`{{${key}}}`, value);
			}
		}

		return {
			query: resolveTemplateString(query, timezone),
			displayQuery: resolveTemplateString(displayQuery, timezone),
		};
	}
}
