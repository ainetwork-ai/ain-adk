import type {
	ArtifactContentPart,
	CanonicalMessageObject,
	DataContentPart,
	LegacyMessageObject,
	MessageContentPart,
	MessageObject,
	MessageRole,
	TextContentPart,
	ThoughtContentPart,
	ThreadObject,
	ToolCallContentPart,
	ToolResultContentPart,
} from "@/types/memory";
import type {
	QueryArtifactInputPart,
	QueryDataInputPart,
	QueryMessageInput,
	QueryTextInputPart,
} from "@/types/message-input";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isCanonicalMessageObject(
	message: MessageObject,
): message is CanonicalMessageObject {
	return Array.isArray((message as CanonicalMessageObject).parts);
}

function normalizeTextPart(part: unknown): TextContentPart {
	return {
		kind: "text",
		text: typeof part === "string" ? part : String(part ?? ""),
	};
}

function normalizeArtifactPart(
	part: Record<string, unknown>,
): ArtifactContentPart {
	return {
		kind: "artifact",
		artifactId: String(part.artifactId ?? ""),
		name: typeof part.name === "string" ? part.name : undefined,
		mimeType: typeof part.mimeType === "string" ? part.mimeType : undefined,
		size: typeof part.size === "number" ? part.size : undefined,
		downloadUrl:
			typeof part.downloadUrl === "string" ? part.downloadUrl : undefined,
		previewText:
			typeof part.previewText === "string" ? part.previewText : undefined,
	};
}

function normalizeDataPart(part: Record<string, unknown>): DataContentPart {
	return {
		kind: "data",
		mimeType:
			typeof part.mimeType === "string"
				? part.mimeType
				: "application/octet-stream",
		data: part.data,
	};
}

function normalizeToolCallPart(
	part: Record<string, unknown>,
): ToolCallContentPart {
	return {
		kind: "tool-call",
		toolCallId: String(part.toolCallId ?? ""),
		toolName: String(part.toolName ?? ""),
		args: part.args,
	};
}

function normalizeToolResultPart(
	part: Record<string, unknown>,
): ToolResultContentPart {
	return {
		kind: "tool-result",
		toolCallId: String(part.toolCallId ?? ""),
		toolName: String(part.toolName ?? ""),
		result: part.result,
	};
}

function normalizeThoughtPart(
	part: Record<string, unknown>,
): ThoughtContentPart {
	return {
		kind: "thought",
		title: String(part.title ?? ""),
		description:
			typeof part.description === "string" ? part.description : undefined,
	};
}

function normalizeKnownPart(
	part: Record<string, unknown>,
): MessageContentPart | undefined {
	switch (part.kind) {
		case "text":
			return normalizeTextPart(part.text);
		case "artifact":
			return normalizeArtifactPart(part);
		case "data":
			return normalizeDataPart(part);
		case "tool-call":
			return normalizeToolCallPart(part);
		case "tool-result":
			return normalizeToolResultPart(part);
		case "thought":
			return normalizeThoughtPart(part);
		default:
			return undefined;
	}
}

function normalizeLegacyContentPart(
	legacyContent: LegacyMessageObject["content"],
	part: unknown,
): MessageContentPart {
	if (isRecord(part) && typeof part.kind === "string") {
		const normalized = normalizeKnownPart(part);
		if (normalized) {
			return normalized;
		}
	}

	if (legacyContent.type === "data" && isRecord(part)) {
		return normalizeDataPart(part);
	}

	return normalizeTextPart(part);
}

export function normalizeMessageParts(
	message: MessageObject,
): Array<MessageContentPart> {
	if (isCanonicalMessageObject(message)) {
		return message.parts;
	}

	const rawParts = Array.isArray(message.content.parts)
		? message.content.parts
		: [message.content.parts];

	return rawParts.map((part) =>
		normalizeLegacyContentPart(message.content, part),
	);
}

export function normalizeMessageObject(
	message: MessageObject,
): CanonicalMessageObject {
	return {
		messageId: message.messageId,
		role: message.role,
		timestamp: message.timestamp,
		metadata: message.metadata,
		schemaVersion: 2,
		parts: normalizeMessageParts(message),
	};
}

export function createTextMessage(params: {
	messageId: string;
	role: MessageRole;
	timestamp: number;
	text: string;
	metadata?: Record<string, unknown>;
}): CanonicalMessageObject {
	return {
		messageId: params.messageId,
		role: params.role,
		timestamp: params.timestamp,
		metadata: params.metadata,
		schemaVersion: 2,
		parts: [{ kind: "text", text: params.text }],
	};
}

export function createToolCallPart(params: {
	toolCallId: string;
	toolName: string;
	args: unknown;
}): ToolCallContentPart {
	return {
		kind: "tool-call",
		toolCallId: params.toolCallId,
		toolName: params.toolName,
		args: params.args,
	};
}

export function createToolResultPart(params: {
	toolCallId: string;
	toolName: string;
	result: unknown;
}): ToolResultContentPart {
	return {
		kind: "tool-result",
		toolCallId: params.toolCallId,
		toolName: params.toolName,
		result: params.result,
	};
}

export function createThoughtPart(params: {
	title: string;
	description?: string;
}): ThoughtContentPart {
	return {
		kind: "thought",
		title: params.title,
		description: params.description,
	};
}

function queryTextPartToContentPart(part: QueryTextInputPart): TextContentPart {
	return { kind: "text", text: part.text };
}

function queryDataPartToContentPart(part: QueryDataInputPart): DataContentPart {
	return {
		kind: "data",
		mimeType: part.mimeType,
		data: part.data,
	};
}

function queryArtifactPartToContentPart(
	part: QueryArtifactInputPart,
): ArtifactContentPart {
	return {
		kind: "artifact",
		artifactId: part.artifactId,
		name: part.name,
		mimeType: part.mimeType,
		size: part.size,
		downloadUrl: part.downloadUrl,
		previewText: part.previewText,
	};
}

export function createMessageFromQueryInput(params: {
	messageId: string;
	role: MessageRole;
	timestamp: number;
	input: QueryMessageInput;
	displayText?: string;
	metadata?: Record<string, unknown>;
}): CanonicalMessageObject {
	const parts = params.input.parts.map((part) => {
		if (part.kind === "text") {
			return queryTextPartToContentPart(part);
		}
		if (part.kind === "artifact") {
			return queryArtifactPartToContentPart(part);
		}
		return queryDataPartToContentPart(part);
	});

	if (params.displayText?.trim()) {
		const isSingleTextMessage = parts.length === 1 && parts[0]?.kind === "text";
		const firstText =
			isSingleTextMessage && parts[0]?.kind === "text"
				? parts[0].text
				: undefined;
		if (!isSingleTextMessage || firstText !== params.displayText) {
			parts.unshift({ kind: "text", text: params.displayText });
		} else {
			parts[0] = { kind: "text", text: params.displayText };
		}
	}

	return {
		messageId: params.messageId,
		role: params.role,
		timestamp: params.timestamp,
		metadata: params.metadata,
		schemaVersion: 2,
		parts,
	};
}

function serializeArtifactPart(part: ArtifactContentPart): string {
	if (part.previewText?.trim()) {
		return part.previewText;
	}

	const artifactLabel = part.name || part.artifactId;
	const metadata: string[] = [];
	if (part.mimeType) {
		metadata.push(part.mimeType);
	}
	if (typeof part.size === "number") {
		metadata.push(`${part.size} bytes`);
	}

	return metadata.length > 0
		? `[Artifact: ${artifactLabel} (${metadata.join(", ")})]`
		: `[Artifact: ${artifactLabel}]`;
}

function serializeDataPart(part: DataContentPart): string {
	if (typeof part.data === "string") {
		return part.data;
	}

	try {
		return `${part.mimeType}: ${JSON.stringify(part.data)}`;
	} catch {
		return `[Data: ${part.mimeType}]`;
	}
}

function serializeToolCallPart(part: ToolCallContentPart): string {
	try {
		return `[Tool Call: ${part.toolName}] ${JSON.stringify(part.args)}`;
	} catch {
		return `[Tool Call: ${part.toolName}]`;
	}
}

function serializeToolResultPart(part: ToolResultContentPart): string {
	if (typeof part.result === "string") {
		return part.result;
	}

	try {
		return `[Tool Result: ${part.toolName}] ${JSON.stringify(part.result)}`;
	} catch {
		return `[Tool Result: ${part.toolName}]`;
	}
}

export function serializePartForIntent(part: MessageContentPart): string {
	switch (part.kind) {
		case "text":
			return part.text;
		case "artifact":
			return serializeArtifactPart(part);
		case "data":
			return serializeDataPart(part);
		case "tool-call":
			return serializeToolCallPart(part);
		case "tool-result":
			return serializeToolResultPart(part);
		case "thought":
			return part.description
				? `${part.title}\n${part.description}`
				: part.title;
	}
}

export function serializeMessageForIntent(message: MessageObject): string {
	return normalizeMessageParts(message)
		.map(serializePartForIntent)
		.filter((value) => value.trim() !== "")
		.join("\n");
}

function roleLabel(role: MessageRole): string {
	switch (role) {
		case "USER":
			return "User";
		case "MODEL":
			return "Assistant";
		case "TOOL":
			return "Tool";
		default:
			return "System";
	}
}

export function serializeThreadForIntent(
	thread: ThreadObject | undefined,
): string {
	if (!thread) {
		return "";
	}

	return thread.messages
		.slice()
		.sort((a, b) => a.timestamp - b.timestamp)
		.map((message) => {
			const content = serializeMessageForIntent(message);
			return `${roleLabel(message.role)}: """${content}"""`;
		})
		.join("\n");
}

export function extractTextContent(message: MessageObject): string {
	return normalizeMessageParts(message)
		.filter((part): part is TextContentPart => part.kind === "text")
		.map((part) => part.text)
		.filter((value) => value.trim() !== "")
		.join("\n");
}
