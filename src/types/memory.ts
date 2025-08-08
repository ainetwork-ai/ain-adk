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

export type ThreadMetadata = {
	type: ThreadType;
	title: string;
	threadId: string;
	updatedAt: number;
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
 *   messages: {
 *     "<UUID_1>": { role: MessageRole.USER, content: {...}, timestamp: 1234567890 },
 *     "<UUID_2>": { role: MessageRole.MODEL, content: {...}, timestamp: 1234567891 }
 *   }
 * };
 * ```
 */
export type ThreadObject = {
	type: ThreadType;
	title: string;
	/* Collection of messages indexed by unique message ID */
	messages: {
		[messageId: string]: MessageObject;
	};
};

export interface Intent {
	name: string;
	description: string;
	prompt?: string;
	llm?: string;
}
