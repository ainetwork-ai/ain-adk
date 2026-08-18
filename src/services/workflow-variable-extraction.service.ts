import type { ModelModule } from "@/modules";
import type { WorkflowVariable } from "@/types/memory";
import { loggers } from "@/utils/logger";

function describeVariable(key: string, spec: WorkflowVariable): string {
	// The JSON key MUST be the variables-record key: the resolver looks
	// values up by record key (and only then derives {{key}}/{{id}} tokens),
	// so values keyed by spec.id alone never substitute {{record_key}} tokens.
	const alias =
		spec.id && spec.id !== key ? `, also known as "${spec.id}"` : "";
	const lines = [`- key: "${key}" (${spec.type}) — ${spec.label}${alias}`];
	if (
		(spec.type === "dropdown" || spec.type === "select") &&
		spec.options?.length
	) {
		lines.push(
			`  value MUST be exactly one of: ${spec.options
				.map((option) => `"${option}"`)
				.join(", ")}`,
		);
	}
	if (spec.type === "date_range") {
		lines.push('  value format: "YYYY-MM-DD ~ YYYY-MM-DD"');
	}
	if (spec.type === "date_parts") {
		lines.push(
			'  value format: "YYYY-MM-DD" (use "YYYY-MM" or "YYYY" if the query is less specific)',
		);
	}
	if (spec.type === "number") {
		lines.push("  value: the number as a plain string");
	}
	return lines.join("\n");
}

function buildExtractionPrompt(
	variableList: string,
	today: string,
	timezone: string,
): string {
	return `You extract workflow variable values from a user's request.

Today's date is ${today} (timezone: ${timezone}).

Variables to extract:
${variableList}

For RELATIVE date expressions, output built-in tokens instead of computing
dates yourself — the system resolves them deterministically in the
workflow's timezone. Available tokens: {{today}}, {{yesterday}},
{{tomorrow}}, {{today+N}}, {{today-N}}, {{startOfWeek}}, {{endOfWeek}},
{{startOfMonth}}, {{endOfMonth}}, {{year}}, {{month}}, {{day}}.
Examples:
- "오늘" → "{{today}}"
- "지난 일주일" / "최근 7일" → "{{today-7}} ~ {{yesterday}}"
- "이번 주" → "{{startOfWeek}} ~ {{endOfWeek}}"
- "이번 달" → "{{startOfMonth}} ~ {{endOfMonth}}"
Only when the request names dates the tokens cannot express (e.g.
"7월 20일부터 26일까지", "지난주 월요일부터 금요일까지"), compute absolute
dates against today's date and output "YYYY-MM-DD" literals. Never invent
token names beyond the list above.

Respond with a single JSON object mapping variable keys to string values.
Rules:
- Include a variable ONLY if its value is clearly stated or derivable from the request. If unsure, OMIT the key entirely — never guess.
- All values must be strings in the format specified per variable.
- Respond with the JSON object only, no other text.`;
}

/** Token grammar of src/utils/template-variables.ts (resolveVariable). An
 * unknown token would survive resolution as a literal "{{...}}" string in
 * the task prompt, so values containing one are rejected here and fall
 * back to the workflow's stored defaults. */
const KNOWN_TEMPLATE_TOKEN_PATTERN =
	/^(?:today|yesterday|tomorrow|now|year|month|day|startOfWeek|endOfWeek|startOfMonth|endOfMonth|today[+-]\d+|(?:year|month|day)[+-]\d+)(?:\|[^}]+)?$/;

function hasUnknownTemplateTokens(value: string): boolean {
	for (const match of value.matchAll(/\{\{(.+?)\}\}/g)) {
		if (!KNOWN_TEMPLATE_TOKEN_PATTERN.test(match[1].trim())) {
			return true;
		}
	}
	return false;
}

export class WorkflowVariableExtractionService {
	private modelModule: ModelModule;

	constructor(modelModule: ModelModule) {
		this.modelModule = modelModule;
	}

	/**
	 * Extracts workflow variable values from a natural-language query with a
	 * single non-streaming LLM call. Returns only values that survive
	 * validation (dropdown/select values must match options); anything
	 * missing falls back to the workflow's stored variableValues at resolve
	 * time. Fails open (returns undefined) on any model or parse error so
	 * intent fulfillment never breaks on extraction.
	 */
	async extractFromQuery(
		variables: Record<string, WorkflowVariable>,
		query: string,
		timezone?: string,
	): Promise<Record<string, string> | undefined> {
		const entries = Object.entries(variables);
		if (entries.length === 0) {
			return undefined;
		}

		try {
			const effectiveTimezone = timezone || "Asia/Seoul";
			const today = new Date().toLocaleDateString("en-CA", {
				timeZone: effectiveTimezone,
			});
			const systemPrompt = buildExtractionPrompt(
				entries.map(([key, spec]) => describeVariable(key, spec)).join("\n"),
				today,
				effectiveTimezone,
			);

			const modelInstance = this.modelModule.getModel();
			const messages = modelInstance.generateMessages({
				query: `User request: """${query}"""`,
				systemPrompt,
			});
			const response = await modelInstance.fetch(
				messages,
				this.modelModule.getModelOptions(),
			);
			if (!response.content) {
				return undefined;
			}

			const parsed = JSON.parse(response.content) as Record<string, unknown>;
			const values: Record<string, string> = {};
			for (const [key, spec] of entries) {
				// Prefer the record key; accept the spec id as a fallback in case
				// the model answered with the alias.
				const value = parsed[key] ?? parsed[spec.id];
				if (typeof value !== "string" || !value.trim()) {
					continue;
				}
				if (hasUnknownTemplateTokens(value)) {
					continue;
				}
				if (
					(spec.type === "dropdown" || spec.type === "select") &&
					spec.options?.length &&
					!spec.options.includes(value.trim())
				) {
					continue;
				}
				values[key] = value.trim();
			}

			if (Object.keys(values).length === 0) {
				return undefined;
			}

			loggers.intent.info("Extracted workflow variables from query", {
				variableIds: Object.keys(values),
			});
			return values;
		} catch (error) {
			loggers.intent.warn(
				"Workflow variable extraction failed; using stored defaults",
				{ error },
			);
			return undefined;
		}
	}
}
