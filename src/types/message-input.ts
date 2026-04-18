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

export type QueryExecutionInput = {
	query: string;
	displayQuery?: string;
	input?: QueryMessageInput;
};

/**
 * Workflow execution remains text-first in the initial milestone.
 *
 * The optional `input` field is reserved so workflow execution boundaries can
 * evolve toward structured query input later without another signature rewrite.
 */
export type WorkflowExecutionInput = {
	query: string;
	displayQuery: string;
	input?: QueryMessageInput;
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
