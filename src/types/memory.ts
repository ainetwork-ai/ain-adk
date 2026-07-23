/**
 * Roles for participants in a message.
 */
export enum MessageRole {
	/** User/human participant */
	USER = "USER",
	/** System-generated messages or instructions */
	SYSTEM = "SYSTEM",
	/** AI model responses */
	MODEL = "MODEL",
}

/**
 * A plain-text segment within a "rich" message.
 */
export type TextPart = {
	type: "text";
	text: string;
};

/**
 * A reference to a {@link Document} within a "rich" message.
 *
 * The body is NOT embedded — clients resolve `documentId` to fetch the latest
 * document (rendering it inline or as a link). `title` is a label hint only.
 */
export type DocumentPart = {
	type: "document";
	documentId: string;
	/** Label hint for rendering (e.g. link text). Not the canonical title. */
	title?: string;
};

/**
 * A single segment of a "rich" message. Discriminated by `type`.
 */
export type MessagePart = TextPart | DocumentPart;

/**
 * Content structure for message content.
 *
 * Supports multi-part content with different types (text, images, etc.).
 *
 * - `type: "text"` — `parts` is `string[]` (legacy/simple text).
 * - `type: "document"` — `parts` is a single `[DocumentPart]` (document-only).
 * - `type: "rich"` — `parts` is `MessagePart[]`, mixing text and document
 *   references in display order.
 */
export type MessageContentObject = {
	/** Content type (e.g., "text", "document", "rich"). */
	type: string;
	/** Array of content parts, structure depends on content type. */
	parts: unknown[];
};

/**
 * Represents a single message in a thread.
 *
 * @example
 * ```typescript
 * const message: MessageObject = {
 *   role: MessageRole.USER,
 *   content: {
 *     type: "text",
 *     parts: ["Hello, how can you help me?"]
 *   },
 *   timestamp: Date.now(),
 *   metadata: { source: "web-ui" }
 * };
 * ```
 */
export type MessageObject = {
	messageId: string;
	/** Role of the message sender */
	role: MessageRole;
	/** Message content with type and parts */
	content: MessageContentObject;
	/** Unix timestamp when the message was created */
	timestamp: number;
	/** Optional metadata for additional context */
	metadata?: { [key: string]: unknown };
};

export enum ThreadType {
	WORKFLOW = "WORKFLOW",
	CHAT = "CHAT",
}

export type ThreadFilter = {
	/** Filter by user workflow ID */
	workflowId?: string;
	/** Filter by thread type */
	type?: ThreadType;
};

export type ThreadMetadata = {
	type: ThreadType;
	title: string;
	userId: string;
	threadId: string;
	isPinned?: boolean;
	/** ID of the user workflow that created this thread */
	workflowId?: string;
	createdAt?: string;
	updatedAt?: string;
};

/**
 * Represents a conversation thread containing multiple messages.
 *
 * Messages are stored in a key-value structure where keys are unique message IDs
 * and values are the corresponding message objects.
 *
 * @example
 * ```typescript
 * const thread: ThreadObject = {
 * 	 title: "New conversation",
 *   messages: [
 *     { messageId: <UUID_1>, role: MessageRole.USER, content: {...}, timestamp: 1234567890 },
 *     { messageId: <UUID_2> ,role: MessageRole.MODEL, content: {...}, timestamp: 1234567891 }
 *   ]
 * };
 * ```
 */
export type ThreadObject = {
	userId: string;
	threadId: string;
	type: ThreadType;
	title: string;
	isPinned?: boolean;
	/** ID of the user workflow that created this thread */
	workflowId?: string;
	messages: Array<MessageObject>;
};

export type IntentToolChoice = "auto" | "required";

export interface Intent {
	id: string;
	name: string;
	description: string;
	status: string;
	prompt?: string;
	triggeringSentences?: Array<string>;
	tags?: Array<string>;
	/** Controls whether the LLM must call a tool for this intent.
	 * - "required": first LLM call must invoke at least one tool
	 * - "auto": LLM decides (default)
	 */
	toolChoice?: IntentToolChoice;
}

export type TriggeredIntent = {
	subquery: string;
	intent?: Intent;
	actionPlan?: string;
};

/**
 * Result of multi-intent triggering.
 * Contains the list of triggered intents and metadata about aggregation.
 */
export type IntentTriggerResult = {
	/** List of triggered intents */
	intents: Array<TriggeredIntent>;
	/** Whether the results need to be aggregated into a unified response */
	needsAggregation: boolean;
};

/**
 * Result of fulfilling a single intent.
 * Used to collect all results before the rewrite step.
 */
export type FulfillmentResult = {
	/** Original subquery that was processed */
	subquery: string;
	/** Matched intent (may be undefined if no match) */
	intent?: Intent;
	/** Action plan description */
	actionPlan?: string;
	/** Response text generated for this intent */
	response: string;
};

export interface WorkflowTaskAgent {
	protocol: "A2A";
	connectorName: string;
}

export interface WorkflowTask {
	taskId: string;
	title: string;
	prompt: string;
	agent?: WorkflowTaskAgent;
}

export interface WorkflowHeadingBlock {
	blockId: string;
	type: "heading";
	level?: 1 | 2 | 3;
	text: string;
}

export interface WorkflowTextBlock {
	blockId: string;
	type: "text";
	prompt: string;
	sourceTaskIds?: string[];
	sourceBlockIds?: string[];
}

export type WorkflowGraphType = "xychart-beta" | "pie";

export interface WorkflowGraphBlockBase {
	blockId: string;
	type: "graph";
	graphType: WorkflowGraphType;
	title?: string;
	prompt: string;
	sourceTaskIds?: string[];
	sourceBlockIds?: string[];
}

export interface WorkflowXYChartSeriesData {
	kind: "bar" | "line";
	label?: string;
	data: number[];
}

export interface WorkflowXYChartBlock extends WorkflowGraphBlockBase {
	graphType: "xychart-beta";
}

export interface WorkflowPieChartSlice {
	label: string;
	value: number;
}

export interface WorkflowPieChartBlock extends WorkflowGraphBlockBase {
	graphType: "pie";
	showData?: boolean;
}

export type WorkflowGraphBlock = WorkflowXYChartBlock | WorkflowPieChartBlock;

export type WorkflowTableLayout = "records" | "matrix";

export type WorkflowTableColumnFormatKind =
	| "auto"
	| "text"
	| "number"
	| "currency"
	| "percent";

export interface WorkflowTableColumnFormat {
	kind?: WorkflowTableColumnFormatKind;
	grouping?: boolean;
	decimals?: number;
	prefix?: string;
	suffix?: string;
	nullDisplay?: string;
}

export interface WorkflowTableBlock {
	blockId: string;
	type: "table";
	layout: WorkflowTableLayout;
	title?: string;
	unit?: string;
	rowHeader?: string;
	rows?: string[];
	columns: string[];
	hiddenRows?: string[];
	hiddenColumns?: string[];
	formulas?: string[];
	sourceTaskIds?: string[];
	prompt?: string;
	columnFormats?: Record<string, WorkflowTableColumnFormat>;
}

export type WorkflowResponseBlock =
	| WorkflowHeadingBlock
	| WorkflowTextBlock
	| WorkflowGraphBlock
	| WorkflowTableBlock;

export interface WorkflowDefinition {
	tasks: WorkflowTask[];
	response: {
		blocks: WorkflowResponseBlock[];
	};
}

export interface WorkflowTaskResult {
	taskId: string;
	title: string;
	agent?: WorkflowTaskAgent;
	status: "completed" | "failed" | "skipped";
	content: string;
	raw?: unknown;
	error?: string;
	startedAt: number;
	completedAt: number;
}

export interface WorkflowRenderedTableSpec {
	layout: WorkflowTableLayout;
	rowHeader?: string;
	rows?: string[];
	columns: string[];
	hiddenRows?: string[];
	hiddenColumns?: string[];
	formulas?: string[];
	columnFormats?: Record<string, WorkflowTableColumnFormat>;
}

export interface WorkflowRenderedTableGridRow {
	key?: string;
	cells: Array<string | number | null>;
	kind?: "data" | "total";
}

export interface WorkflowRenderedTableMetadata {
	unit?: string;
}

export interface WorkflowRenderedTableData {
	spec: WorkflowRenderedTableSpec;
	metadata?: WorkflowRenderedTableMetadata;
	table: {
		headers: string[];
		rows: WorkflowRenderedTableGridRow[];
	};
	warnings?: string[];
}

export interface WorkflowRenderedXYChartData {
	graphType: "xychart-beta";
	title?: string;
	xAxis: string[];
	yAxis?: {
		label?: string;
		min?: number;
		max?: number;
	};
	series: WorkflowXYChartSeriesData[];
}

export interface WorkflowRenderedPieChartData {
	graphType: "pie";
	title?: string;
	showData?: boolean;
	slices: WorkflowPieChartSlice[];
}

export type WorkflowRenderedGraphSpec =
	| WorkflowRenderedXYChartData
	| WorkflowRenderedPieChartData;

export interface WorkflowRenderedGraphData {
	spec: WorkflowRenderedGraphSpec;
	mermaid: string;
	warnings?: string[];
}

export type WorkflowRenderedBlockData =
	| WorkflowRenderedTableData
	| WorkflowRenderedGraphData;

export interface WorkflowRenderedBlock {
	blockId: string;
	type: WorkflowResponseBlock["type"];
	content: string;
	data?: WorkflowRenderedBlockData;
}

export type WorkflowVariableType =
	| "select"
	| "dropdown"
	| "date_range"
	| "date_parts"
	| "text"
	| "number";

export type WorkflowVariableResolveAt = "creation" | "execution";

export interface WorkflowVariablePartSpec {
	token?: string;
	id?: string;
	key?: string;
	label?: string;
	name?: string;
	placeholder?: string;
	format?: string;
	source?: "value" | "start" | "end";
}

export interface WorkflowVariable {
	id: string; // e.g. "workplace_id"
	label: string; // e.g. "분석할 업장을 선택해주세요"
	type: WorkflowVariableType;
	options?: Array<string>; // for "select" or "dropdown" type
	parts?: Record<string, string> | WorkflowVariablePartSpec[];
	/** When to resolve this variable:
	 * - "creation": resolved when copying template → my workflow (e.g., store selection)
	 * - "execution": resolved each time the workflow runs (e.g., date range)
	 * Defaults to "creation" if not specified.
	 */
	resolveAt?: WorkflowVariableResolveAt;
}

/**
 * A workflow template — an immutable blueprint for creating user workflows.
 * System-provided or admin-defined.
 */
export interface WorkflowTemplate {
	templateId: string;
	title: string;
	description: string;
	active: boolean;
	/** Classification label for grouping templates in the UI (e.g. "식음", "객실"). */
	category?: string;
	/** The prompt/instruction template with {{variable}} placeholders */
	content: string;
	/** Structured workflow definition. If omitted, legacy content execution is used. */
	definition?: WorkflowDefinition;
	/** Variable schema definitions (type, label, options) for UI rendering */
	variables?: Record<string, WorkflowVariable>;
	/**
	 * Hidden templates are excluded from list responses by default
	 * (e.g. document-advice-only workflows). Fetch-by-id is unaffected.
	 */
	hidden?: boolean;
}

/**
 * A user-owned workflow instance, optionally created from a WorkflowTemplate.
 *
 * Supports:
 * - Internal execution via scheduler/service
 * - Scheduled execution via cron expression
 * - Template variables (e.g., {{today}}, {{yesterday}}) resolved at execution time
 * - User-defined variable values resolved at execution time
 */
export interface UserWorkflow {
	workflowId: string;
	userId: string;
	title: string;
	description?: string;
	active: boolean;
	/** Classification label for grouping workflows in the UI (e.g. "식음", "객실"). Copied from the source template. */
	category?: string;

	/** Reference to the original WorkflowTemplate (optional) */
	templateId?: string;
	/** The prompt/instruction content with {{variable}} placeholders */
	content: string;
	/** Structured workflow definition. If omitted, legacy content execution is used. */
	definition?: WorkflowDefinition;
	/** Variable schema definitions (copied from template, used for UI rendering) */
	variables?: Record<string, WorkflowVariable>;
	/** User-provided variable values (can contain template variables like {{today}}) */
	variableValues?: Record<string, string>;

	/** Cron expression for scheduled execution (e.g., "0 9 * * *"). If not set, manual-only. */
	schedule?: string;
	/** IANA timezone (e.g., "Asia/Seoul"). Defaults to system timezone. */
	timezone?: string;

	/** Unix timestamp of the last execution */
	lastRunAt?: number;
	/** Unix timestamp of the next scheduled execution */
	nextRunAt?: number;
	/** Thread ID of the last execution result */
	lastThreadId?: string;
}
