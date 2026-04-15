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
	/** Tool-generated messages or results */
	TOOL = "TOOL",
}

/**
 * Legacy message content structure kept for backward-compatible reads.
 */
export type LegacyMessageContentObject = {
	/** Content type (e.g., "text", "image", "tool_use") */
	type: string;
	/** Array of content parts, structure depends on content type */
	parts: any[];
};

export type TextContentPart = {
	kind: "text";
	text: string;
};

export type ArtifactContentPart = {
	kind: "artifact";
	artifactId: string;
	name?: string;
	mimeType?: string;
	size?: number;
	downloadUrl?: string;
	previewText?: string;
};

export type DataContentPart = {
	kind: "data";
	mimeType: string;
	data: unknown;
};

export type ToolCallContentPart = {
	kind: "tool-call";
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type ToolResultContentPart = {
	kind: "tool-result";
	toolCallId: string;
	toolName: string;
	result: unknown;
};

export type ThoughtContentPart = {
	kind: "thought";
	title: string;
	description?: string;
};

export type MessageContentPart =
	| TextContentPart
	| ArtifactContentPart
	| DataContentPart
	| ToolCallContentPart
	| ToolResultContentPart
	| ThoughtContentPart;

type MessageBase = {
	messageId: string;
	/** Role of the message sender */
	role: MessageRole;
	/** Unix timestamp when the message was created */
	timestamp: number;
	/** Optional metadata for additional context */
	metadata?: { [key: string]: unknown };
};

export type LegacyMessageObject = MessageBase & {
	schemaVersion?: 1;
	/** Message content with type and parts */
	content: LegacyMessageContentObject;
	parts?: never;
};

export type CanonicalMessageObject = MessageBase & {
	schemaVersion: 2;
	/** Multipart-first message content */
	parts: Array<MessageContentPart>;
	content?: never;
};

/**
 * Represents a single message in a thread.
 *
 * @example
 * ```typescript
 * const message: MessageObject = {
 *   schemaVersion: 2,
 *   role: MessageRole.USER,
 *   parts: [{ kind: "text", text: "Hello, how can you help me?" }],
 *   timestamp: Date.now(),
 *   metadata: { source: "web-ui" }
 * };
 * ```
 */
export type MessageObject = LegacyMessageObject | CanonicalMessageObject;

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
 *     { messageId: <UUID_1>, role: MessageRole.USER, parts: [...], timestamp: 1234567890, schemaVersion: 2 },
 *     { messageId: <UUID_2> ,role: MessageRole.MODEL, parts: [...], timestamp: 1234567891, schemaVersion: 2 }
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

export type WorkflowVariableType =
	| "select"
	| "date_range"
	| "date_parts"
	| "text"
	| "number";

export type WorkflowVariableResolveAt = "creation" | "execution";

export interface WorkflowVariable {
	id: string; // e.g. "workplace_id"
	label: string; // e.g. "분석할 업장을 선택해주세요"
	type: WorkflowVariableType;
	options?: Array<string>; // for "select" type
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
