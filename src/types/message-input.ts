export type QueryTextInputPart = {
	kind: "text";
	text: string;
};

export type QueryDataInputPart = {
	kind: "data";
	mimeType: string;
	data: unknown;
};

export type QueryArtifactInputPart = {
	kind: "artifact";
	artifactId: string;
	name?: string;
	mimeType?: string;
	size?: number;
	downloadUrl?: string;
	previewText?: string;
};

export type QueryInputPart =
	| QueryTextInputPart
	| QueryDataInputPart
	| QueryArtifactInputPart;

export type QueryMessageInput = {
	parts: QueryInputPart[];
};

export type QueryRequestInput = {
	message?: string;
	displayMessage?: string;
	input?: QueryMessageInput;
};

export type NormalizedQueryRequest = {
	input: QueryMessageInput;
	query: string;
	displayQuery?: string;
};
