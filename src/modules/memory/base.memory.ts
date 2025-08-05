import type {
	ChatObject,
	Intent,
	SessionMetadata,
	SessionObject,
} from "@/types/memory";

/**
 * Base interface for all memory implementations
 */
export interface IMemory {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	isConnected(): boolean;
}

/**
 * Session memory interface
 */
export interface ISessionMemory extends IMemory {
	getSession(
		userId: string,
		sessionId: string,
	): Promise<SessionObject | undefined>;
	createSession(
		userId: string,
		sessionId: string,
		title: string,
	): Promise<void>;
	addChatToSession(
		userId: string,
		sessionId: string,
		chat: ChatObject,
	): Promise<void>;
	deleteSession(userId: string, sessionId: string): Promise<void>;
	listSessions(userId: string): Promise<SessionMetadata[]>;
}

/**
 * Intent memory interface
 */
export interface IIntentMemory extends IMemory {
	getIntent(intentId: string): Promise<Intent | undefined>;
	saveIntent(intent: Intent): Promise<void>;
	updateIntent(intentId: string, intent: Intent): Promise<void>;
	deleteIntent(intentId: string): Promise<void>;
	listIntents(): Promise<Intent[]>;
}

/**
 * Agent memory interface for storing agent configuration
 */
export interface IAgentMemory extends IMemory {}
