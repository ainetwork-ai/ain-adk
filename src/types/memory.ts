/**
 * Roles for participants in a chat conversation.
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
 * Content structure for chat messages.
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
 * Represents a single message in a chat conversation.
 *
 * @example
 * ```typescript
 * const message: ChatObject = {
 *   role: ChatRole.USER,
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

export type ThreadMetadata = {
	type: "workflow" | "chat";
	title: string;
	threadId: string;
	updatedAt: number;
};

/**
 * Represents a conversation thread containing multiple chat messages.
 *
 * Messages are stored in a key-value structure where keys are unique chat IDs
 * and values are the corresponding chat objects.
 *
 * @example
 * ```typescript
 * const thread: ThreadObject = {
 * 	 title: "New conversation",
 *   chats: {
 *     "<UUID_1>": { role: ChatRole.USER, content: {...}, timestamp: 1234567890 },
 *     "<UUID_2>": { role: ChatRole.MODEL, content: {...}, timestamp: 1234567891 }
 *   }
 * };
 * ```
 */
export type ThreadObject = {
	type: "workflow" | "chat";
	title: string;
	/** Collection of chat messages indexed by unique chat ID */
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
