import { randomUUID } from "node:crypto";
import type {
	Artifact as A2AArtifact,
	DataPart as A2ADataPart,
	FilePart as A2AFilePart,
	Message as A2AMessage,
	Part as A2APart,
	TextPart as A2ATextPart,
} from "@a2a-js/sdk";
import type { ArtifactContentPart, MessageObject } from "@/types/memory.js";
import type {
	QueryArtifactInputPart,
	QueryDataInputPart,
	QueryMessageInput,
	QueryTextInputPart,
} from "@/types/message-input.js";
import {
	createModelInputMessageFromQueryInput,
	normalizeMessageObject,
	serializeMessageForModelFallback,
	serializePartForModelFallback,
} from "@/utils/message.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArtifactMetadata(metadata: unknown): {
	artifactId?: string;
	size?: number;
	previewText?: string;
	downloadUrl?: string;
	mimeType?: string;
	name?: string;
} {
	if (!isRecord(metadata)) {
		return {};
	}

	return {
		artifactId:
			typeof metadata.artifactId === "string" ? metadata.artifactId : undefined,
		size: typeof metadata.size === "number" ? metadata.size : undefined,
		previewText:
			typeof metadata.previewText === "string"
				? metadata.previewText
				: undefined,
		downloadUrl:
			typeof metadata.downloadUrl === "string"
				? metadata.downloadUrl
				: undefined,
		mimeType:
			typeof metadata.mimeType === "string" ? metadata.mimeType : undefined,
		name: typeof metadata.name === "string" ? metadata.name : undefined,
	};
}

function buildArtifactMetadata(
	part: ArtifactContentPart,
): Record<string, unknown> {
	return {
		artifactId: part.artifactId,
		downloadUrl: part.downloadUrl,
		mimeType: part.mimeType,
		name: part.name,
		previewText: part.previewText,
		size: part.size,
	};
}

function textPartToQueryInputPart(part: A2ATextPart): QueryTextInputPart {
	return {
		kind: "text",
		text: part.text,
	};
}

function dataPartToQueryInputPart(part: A2ADataPart): QueryDataInputPart {
	const mimeType =
		isRecord(part.metadata) && typeof part.metadata.mimeType === "string"
			? part.metadata.mimeType
			: "application/json";

	return {
		kind: "data",
		mimeType,
		data: part.data,
	};
}

function filePartToQueryInputPart(
	part: A2AFilePart,
	index: number,
): QueryArtifactInputPart {
	const metadata = parseArtifactMetadata(part.metadata);
	const file = part.file;
	const fallbackId =
		"uri" in file
			? file.uri
			: (typeof file.name === "string" && file.name.trim()) ||
				`a2a-file-${index}-${randomUUID()}`;

	return {
		kind: "artifact",
		artifactId: metadata.artifactId ?? fallbackId,
		name: file.name ?? metadata.name,
		mimeType: file.mimeType ?? metadata.mimeType,
		size: metadata.size,
		downloadUrl: metadata.downloadUrl ?? ("uri" in file ? file.uri : undefined),
		previewText: metadata.previewText,
	};
}

export function createQueryInputFromA2AMessage(
	message: Pick<A2AMessage, "parts">,
): QueryMessageInput {
	return {
		parts: message.parts.map((part, index) => {
			if (part.kind === "text") {
				return textPartToQueryInputPart(part);
			}
			if (part.kind === "file") {
				return filePartToQueryInputPart(part, index);
			}
			return dataPartToQueryInputPart(part);
		}),
	};
}

export function serializeA2AMessageForFallback(
	message: Pick<A2AMessage, "parts">,
): string {
	return serializeMessageForModelFallback(
		createModelInputMessageFromQueryInput({
			input: createQueryInputFromA2AMessage(message),
		}),
	);
}

function createA2AFilePart(part: ArtifactContentPart): A2AFilePart | undefined {
	if (!part.downloadUrl) {
		return undefined;
	}

	return {
		kind: "file",
		file: {
			uri: part.downloadUrl,
			name: part.name,
			mimeType: part.mimeType,
		},
		metadata: buildArtifactMetadata(part),
	};
}

function getA2AFileUri(filePart: A2AFilePart | undefined): string | undefined {
	if (!filePart) {
		return undefined;
	}

	return "uri" in filePart.file ? filePart.file.uri : undefined;
}

function createA2ADataPart(part: {
	mimeType: string;
	data: unknown;
}): A2ADataPart {
	return {
		kind: "data",
		data: isRecord(part.data)
			? part.data
			: {
					mimeType: part.mimeType,
					value: part.data,
				},
		metadata: {
			mimeType: part.mimeType,
		},
	};
}

export function createA2AMessagePartsFromMessage(
	message: MessageObject,
): A2APart[] {
	const canonical = normalizeMessageObject(message);
	const parts: A2APart[] = [];

	for (const part of canonical.parts) {
		if (part.kind === "text") {
			parts.push({
				kind: "text",
				text: part.text,
			});
			continue;
		}

		if (part.kind === "artifact") {
			const filePart = createA2AFilePart(part);
			if (filePart) {
				parts.push(filePart);
			} else {
				parts.push({
					kind: "text",
					text: serializePartForModelFallback(part),
					metadata: buildArtifactMetadata(part),
				});
			}
			continue;
		}

		if (part.kind === "data") {
			parts.push(createA2ADataPart(part));
			continue;
		}

		parts.push({
			kind: "text",
			text: serializePartForModelFallback(part),
		});
	}

	return parts;
}

function createArtifactPreviewPart(part: ArtifactContentPart): A2ATextPart {
	return {
		kind: "text",
		text: part.previewText?.trim() || serializePartForModelFallback(part),
		metadata: buildArtifactMetadata(part),
	};
}

export function createA2AArtifactsFromMessage(
	message: MessageObject,
): A2AArtifact[] {
	const canonical = normalizeMessageObject(message);

	return canonical.parts
		.filter((part): part is ArtifactContentPart => part.kind === "artifact")
		.map((part) => {
			const previewPart = createArtifactPreviewPart(part);
			const filePart = createA2AFilePart(part);

			return {
				artifactId: part.artifactId,
				name: part.name,
				description: part.previewText,
				metadata: buildArtifactMetadata(part),
				parts: filePart ? [previewPart, filePart] : [previewPart],
			};
		});
}

export function artifactContentPartFromA2AArtifact(
	artifact: A2AArtifact,
): ArtifactContentPart {
	const metadata = parseArtifactMetadata(artifact.metadata);
	const filePart = artifact.parts.find(
		(part): part is A2AFilePart => part.kind === "file",
	);
	const previewPart = artifact.parts.find(
		(part): part is A2ATextPart => part.kind === "text",
	);

	return {
		kind: "artifact",
		artifactId: artifact.artifactId,
		name: artifact.name ?? filePart?.file.name ?? metadata.name,
		mimeType: filePart?.file.mimeType ?? metadata.mimeType,
		size: metadata.size,
		downloadUrl: getA2AFileUri(filePart) ?? metadata.downloadUrl,
		previewText: previewPart?.text ?? metadata.previewText,
	};
}

export function extractArtifactPartsFromA2AMessage(
	message: Pick<A2AMessage, "parts">,
): ArtifactContentPart[] {
	return message.parts
		.filter((part): part is A2AFilePart => part.kind === "file")
		.map((part, index) => filePartToQueryInputPart(part, index))
		.map((part) => ({
			kind: "artifact" as const,
			artifactId: part.artifactId,
			name: part.name,
			mimeType: part.mimeType,
			size: part.size,
			downloadUrl: part.downloadUrl,
			previewText: part.previewText,
		}));
}
