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
	parts: any[];
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
	/** Filter by scheduled job ID */
	jobId?: string;
	/** Filter by thread type */
	type?: ThreadType;
};

export type ThreadMetadata = {
	type: ThreadType;
	title: string;
	userId: string;
	threadId: string;
	isPinned?: boolean;
	/** ID of the scheduled job that created this thread */
	jobId?: string;
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
	/** ID of the scheduled job that created this thread */
	jobId?: string;
	messages: Array<MessageObject>;
};

export interface Intent {
	id: string;
	name: string;
	description: string;
	status: string;
	prompt?: string;
	triggeringSentences?: Array<string>;
	tags?: Array<string>;
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

export type WorkflowVariableType = "select" | "date_range" | "text" | "number";

export interface WorkflowVariable {
	id: string; // e.g. "workplace_id"
	label: string; // e.g. "분석할 업장을 선택해주세요"
	type: WorkflowVariableType;
	options?: Array<string>; // for "select" type
}

export interface Workflow {
	workflowId: string;
	userId?: string;
	title: string;
	description: string;
	active: boolean;
	content: string;
	variables?: Record<string, WorkflowVariable>;
}

/**
 * Represents a scheduled job that automatically executes a query or workflow
 * at specified times based on a cron schedule.
 *
 * Supports template variables (e.g., `{{today}}`, `{{yesterday}}`) in query
 * and workflowVariables that are resolved at execution time.
 */
export interface ScheduledJob {
	jobId: string;
	userId: string;
	title: string;
	description?: string;
	active: boolean;

	/** Direct query with optional template variables (e.g., "{{yesterday}} 매출 분석") */
	query?: string;
	/** Reference to a workflow to execute */
	workflowId?: string;
	/** Variable values for the workflow (can contain template variables) */
	workflowVariables?: Record<string, string>;

	/** Cron expression (e.g., "0 9 * * *" for daily at 9am) */
	schedule: string;
	/** IANA timezone (e.g., "Asia/Seoul"). Defaults to system timezone. */
	timezone?: string;

	/** Unix timestamp of the last execution */
	lastRunAt?: number;
	/** Unix timestamp of the next scheduled execution */
	nextRunAt?: number;
	/** Thread ID of the last execution result */
	lastThreadId?: string;
}
