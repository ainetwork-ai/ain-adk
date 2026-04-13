export type ArtifactStatus = "uploaded" | "processing" | "ready" | "failed";

export type ArtifactPreviewStatus = "pending" | "ready" | "failed";

export type ArtifactRef = {
	artifactId: string;
	name: string;
	mimeType: string;
	size: number;
	downloadUrl?: string;
	previewText?: string;
};

export type ArtifactObject = {
	artifactId: string;
	userId?: string;
	threadId?: string;
	messageId?: string;
	status: ArtifactStatus;
	name: string;
	mimeType: string;
	size: number;
	checksum?: string;
	storageKey: string;
	previewText?: string;
	previewStatus?: ArtifactPreviewStatus;
	metadata?: Record<string, unknown>;
	createdAt: number;
};

export type ArtifactPutInput = {
	name: string;
	mimeType: string;
	data: Uint8Array;
	userId?: string;
	threadId?: string;
	messageId?: string;
	metadata?: Record<string, unknown>;
};

export type ArtifactDownloadResult = {
	body: Uint8Array;
	mimeType: string;
	fileName?: string;
	contentLength?: number;
	metadata?: Record<string, unknown>;
};
