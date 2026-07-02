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
 * A resolved result fragment produced by a workflow/query execution.
 *
 * This is the same shape a workflow already produces (markdown + structured
 * render blocks); it fills a single {@link DocumentSlot}.
 */
export interface DocumentFragment {
	/** Rendered markdown for this fragment. */
	content: string;
	/** Structured render artifacts (tables/graphs) for rich rendering. */
	blocks?: WorkflowRenderedBlock[];
	/** What produced this fragment. */
	source:
		| { type: "WORKFLOW"; workflowId: string }
		| { type: "QUERY"; query: string };
	/** ISO timestamp when the fragment was resolved. */
	resolvedAt: string;
}

export type DocumentSlotStatus = "empty" | "running" | "resolved" | "failed";

/**
 * A placeholder within a document body, addressed by a `{{slot:slotId}}` token
 * in {@link Document.content}. Filled on demand by a bound workflow/query.
 */
export interface DocumentSlot {
	/** Matches the `{{slot:slotId}}` token in the document content. */
	slotId: string;
	/** Human-readable label for the slot. */
	label?: string;
	/** Fill lifecycle status. */
	status: DocumentSlotStatus;
	/**
	 * Pre-declared source that fills this slot. A fill request may override
	 * the workflow/variables explicitly.
	 */
	binding?:
		| {
				type: "WORKFLOW";
				workflowId: string;
				executionVariables?: Record<string, string>;
		  }
		| { type: "QUERY"; query: string };
	/** Resolved result once filled. */
	fragment?: DocumentFragment;
	/** Error message when `status === "failed"`. */
	error?: string;
}

/**
 * A first-class, mutable document.
 *
 * Documents hold the canonical result of a workflow/query as markdown and are
 * referenced from threads (rather than embedded), so manual edits are always
 * reflected wherever the document is rendered.
 *
 * - `content` is the canonical markdown (the edit target). It may contain
 *   `{{slot:slotId}}` tokens that are substituted with the resolved fragment
 *   of the matching {@link DocumentSlot}.
 * - `blocks` are the structured render artifacts captured at creation time and
 *   are read-only metadata. After a manual edit (`editedManually = true`) they
 *   may no longer be in sync with `content`.
 */
/** AI-generated advice derived from a document's rendered content. */
export interface DocumentAdvice {
	/** Generated advice text (plain prose / light markdown). */
	content: string;
	/** ISO timestamp when generated. */
	generatedAt: string;
}

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
	/** Cached AI advice generated from the rendered content. */
	advice?: DocumentAdvice;
	/** Placeholder slots referenced by `{{slot:slotId}}` tokens in `content`. */
	slots?: DocumentSlot[];
	/**
	 * Faceted grouping dimensions, e.g.
	 * `{ category: "logbook", workplaceId: "123", month: "2026-06" }`.
	 *
	 * The hierarchy/nesting order is NOT encoded here — it is decided at query
	 * or render time by choosing an order of label keys. This keeps grouping
	 * extensible to any number of levels without schema changes.
	 */
	labels?: Record<string, string>;
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
 *
 * `labels` is a subset match: every provided key must match the document's
 * corresponding label. A string value matches exactly; a string[] value
 * matches if the document's label is any of the array (`$in`).
 */
export type DocumentFilter = {
	workflowId?: string;
	threadId?: string;
	source?: DocumentSource;
	labels?: Record<string, string | string[]>;
};
