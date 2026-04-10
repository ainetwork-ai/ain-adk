import { StatusCodes } from "http-status-codes";
import { AinHttpError } from "@/types/agent";
import type {
	NormalizedQueryRequest,
	QueryArtifactInputPart,
	QueryDataInputPart,
	QueryInputPart,
	QueryMessageInput,
	QueryRequestInput,
	QueryTextInputPart,
} from "@/types/message-input";

type NormalizeQueryInputOptions = {
	artifactModuleConfigured: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function serializeArtifactPart(part: QueryArtifactInputPart): string {
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

function serializeDataPart(part: QueryDataInputPart): string {
	if (typeof part.data === "string") {
		return part.data;
	}

	try {
		return `${part.mimeType}: ${JSON.stringify(part.data)}`;
	} catch {
		return `[Data: ${part.mimeType}]`;
	}
}

function serializePart(part: QueryInputPart): string {
	if (part.kind === "text") {
		return part.text;
	}
	if (part.kind === "artifact") {
		return serializeArtifactPart(part);
	}
	return serializeDataPart(part);
}

function validateTextPart(part: Record<string, unknown>): QueryTextInputPart {
	if (typeof part.text !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Text parts require a string 'text' field.",
			"INVALID_QUERY_INPUT",
		);
	}

	return {
		kind: "text",
		text: part.text,
	};
}

function validateDataPart(part: Record<string, unknown>): QueryDataInputPart {
	if (typeof part.mimeType !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Data parts require a string 'mimeType' field.",
			"INVALID_QUERY_INPUT",
		);
	}

	return {
		kind: "data",
		mimeType: part.mimeType,
		data: part.data,
	};
}

function validateArtifactPart(
	part: Record<string, unknown>,
	options: NormalizeQueryInputOptions,
): QueryArtifactInputPart {
	if (!options.artifactModuleConfigured) {
		throw new AinHttpError(
			StatusCodes.SERVICE_UNAVAILABLE,
			"Artifact input requires an artifact module to be configured.",
			"ARTIFACT_STORE_NOT_CONFIGURED",
		);
	}

	if (typeof part.artifactId !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact parts require a string 'artifactId' field.",
			"INVALID_QUERY_INPUT",
		);
	}

	const artifactPart: QueryArtifactInputPart = {
		kind: "artifact",
		artifactId: part.artifactId,
	};

	if (typeof part.name === "string") {
		artifactPart.name = part.name;
	}
	if (typeof part.mimeType === "string") {
		artifactPart.mimeType = part.mimeType;
	}
	if (typeof part.size === "number") {
		artifactPart.size = part.size;
	}
	if (typeof part.downloadUrl === "string") {
		artifactPart.downloadUrl = part.downloadUrl;
	}
	if (typeof part.previewText === "string") {
		artifactPart.previewText = part.previewText;
	}

	return artifactPart;
}

function validateStructuredInput(
	input: unknown,
	options: NormalizeQueryInputOptions,
): QueryMessageInput {
	if (!isObject(input) || !Array.isArray(input.parts)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Structured query input requires an 'input.parts' array.",
			"INVALID_QUERY_INPUT",
		);
	}

	if (input.parts.length === 0) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Structured query input requires at least one part.",
			"INVALID_QUERY_INPUT",
		);
	}

	const parts = input.parts.map((part) => {
		if (!isObject(part) || typeof part.kind !== "string") {
			throw new AinHttpError(
				StatusCodes.BAD_REQUEST,
				"Each query input part must be an object with a valid 'kind'.",
				"INVALID_QUERY_INPUT",
			);
		}

		if (part.kind === "text") {
			return validateTextPart(part);
		}
		if (part.kind === "data") {
			return validateDataPart(part);
		}
		if (part.kind === "artifact") {
			return validateArtifactPart(part, options);
		}

		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			`Unsupported query input part kind: ${part.kind}`,
			"INVALID_QUERY_INPUT",
		);
	});

	return { parts };
}

export function normalizeQueryRequest(
	rawInput: unknown,
	options: NormalizeQueryInputOptions,
): NormalizedQueryRequest {
	if (!isObject(rawInput)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Query request body must be an object.",
			"INVALID_QUERY_INPUT",
		);
	}

	const body = rawInput as QueryRequestInput;
	const hasLegacyMessage = typeof body.message === "string";
	const hasStructuredInput = body.input !== undefined;

	if (hasLegacyMessage && hasStructuredInput) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Provide either 'message' or 'input', but not both.",
			"INVALID_QUERY_INPUT",
		);
	}

	if (!hasLegacyMessage && !hasStructuredInput) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Query request requires either 'message' or 'input'.",
			"INVALID_QUERY_INPUT",
		);
	}

	if (hasLegacyMessage) {
		const message = body.message as string;
		return {
			input: {
				parts: [{ kind: "text", text: message }],
			},
			query: message,
			displayQuery:
				typeof body.displayMessage === "string"
					? body.displayMessage
					: undefined,
		};
	}

	const input = validateStructuredInput(body.input, options);
	const query = input.parts
		.map(serializePart)
		.filter((value) => value.trim() !== "")
		.join("\n");

	return {
		input,
		query,
		displayQuery:
			typeof body.displayMessage === "string" ? body.displayMessage : undefined,
	};
}
