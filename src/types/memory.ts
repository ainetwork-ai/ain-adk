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
 * Content structure for message content.
 *
 * Supports multi-part content with different types (text, images, etc.).
 */
export type MessageContentObject = {
	/** Content type (e.g., "text", "image", "tool_use") */
	type: string;
	/** Array of content parts, structure depends on content type */
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
	outputKey?: string;
	dependsOn?: string[];
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
}

export type WorkflowTableLayout = "records" | "matrix";

export interface WorkflowTableBlock {
	blockId: string;
	type: "table";
	layout: WorkflowTableLayout;
	title?: string;
	rowHeader?: string;
	rows?: string[];
	columns: string[];
	formulas?: string[];
	sourceTaskIds?: string[];
	prompt?: string;
}

export type WorkflowResponseBlock =
	| WorkflowHeadingBlock
	| WorkflowTextBlock
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
	formulas?: string[];
}

export interface WorkflowRenderedTableGridRow {
	key?: string;
	cells: Array<string | number | null>;
	kind?: "data" | "total";
}

export interface WorkflowRenderedTableData {
	spec: WorkflowRenderedTableSpec;
	table: {
		headers: string[];
		rows: WorkflowRenderedTableGridRow[];
	};
	warnings?: string[];
}

export interface WorkflowRenderedBlock {
	blockId: string;
	type: WorkflowResponseBlock["type"];
	content: string;
	data?: WorkflowRenderedTableData;
}

export type WorkflowVariableType =
	| "select"
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
	options?: Array<string>; // for "select" type
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
	/** The prompt/instruction template with {{variable}} placeholders */
	content: string;
	/** Structured workflow definition. If omitted, legacy content execution is used. */
	definition?: WorkflowDefinition;
	/** Variable schema definitions (type, label, options) for UI rendering */
	variables?: Record<string, WorkflowVariable>;
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
