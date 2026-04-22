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
