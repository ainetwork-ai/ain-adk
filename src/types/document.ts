import type { WorkflowRenderedBlock } from "./memory.js";

/**
 * Storage/render format of a document body.
 * Currently only markdown is supported.
 */
export enum DocumentFormat {
	MARKDOWN = "MARKDOWN",
}

/**
 * Origin of a document.
 * - WORKFLOW: produced by a user workflow execution
 * - QUERY: produced by a standard query response
 * - MANUAL: created directly by a human
 */
export enum DocumentSource {
	WORKFLOW = "WORKFLOW",
	QUERY = "QUERY",
	MANUAL = "MANUAL",
}

/**
 * A first-class, mutable document.
 *
 * Documents hold the canonical result of a workflow/query as markdown and are
 * referenced from threads (rather than embedded), so manual edits are always
 * reflected wherever the document is rendered.
 *
 * - `content` is the canonical markdown (the edit target).
 * - `blocks` are the structured render artifacts captured at creation time and
 *   are read-only metadata. After a manual edit (`editedManually = true`) they
 *   may no longer be in sync with `content`.
 */
export interface Document {
	documentId: string;
	userId: string;
	title: string;
	/** Body format. Defaults to MARKDOWN. */
	format: DocumentFormat;
	/** Canonical markdown body — the display and edit target. */
	content: string;
	/** Structured render artifacts captured at creation (read-only metadata). */
	blocks?: WorkflowRenderedBlock[];
	/** Where this document came from. */
	source: DocumentSource;
	/** Source workflow when `source === WORKFLOW`. */
	workflowId?: string;
	/** Thread this document was created in (back-reference). */
	threadId?: string;
	/** Incremented on every update. Starts at 1. */
	version: number;
	/** True once a human has edited `content`; `blocks` may then be stale. */
	editedManually?: boolean;
	/** ISO timestamp of creation. */
	createdAt: string;
	/** ISO timestamp of the last update. */
	updatedAt: string;
}

/**
 * Optional filters for listing documents.
 */
export type DocumentFilter = {
	workflowId?: string;
	threadId?: string;
	source?: DocumentSource;
};
