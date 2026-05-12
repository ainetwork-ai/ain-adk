export const ADK_THINKING_ARG = "__adk_thinking_text";

type JsonSchemaObject = {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
};

export function withAdkThinkingArg(
	inputSchema: JsonSchemaObject | undefined,
	prompt: string,
): JsonSchemaObject {
	const required = new Set(inputSchema?.required || []);
	required.add(ADK_THINKING_ARG);

	return {
		...(inputSchema || {}),
		type: "object",
		properties: {
			...(inputSchema?.properties || {}),
			[ADK_THINKING_ARG]: {
				type: "string",
				description: prompt,
			},
		},
		required: [...required],
	};
}

export function splitAdkToolArgs(args: Record<string, unknown> | undefined): {
	thinkingText: string;
	protocolArgs: Record<string, unknown>;
} {
	const safeArgs = args || {};
	const { [ADK_THINKING_ARG]: thinkingText, ...protocolArgs } = safeArgs;

	return {
		thinkingText: typeof thinkingText === "string" ? thinkingText : "",
		protocolArgs,
	};
}

const THINKING_TITLE_MAX_LENGTH = 150;
const THINKING_DESCRIPTION_MAX_LENGTH = 300;

function truncate(text: string, maxLength: number): string {
	if (!text || text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function truncateThinkingDescription(
	text: string,
	maxLength: number = THINKING_DESCRIPTION_MAX_LENGTH,
): string {
	return truncate(text, maxLength);
}

export function sanitizeThinkingData<
	T extends { title?: string; description?: string },
>(data: T): T {
	return {
		...data,
		title: truncate(data.title ?? "", THINKING_TITLE_MAX_LENGTH),
		description: truncate(
			data.description ?? "",
			THINKING_DESCRIPTION_MAX_LENGTH,
		),
	};
}
