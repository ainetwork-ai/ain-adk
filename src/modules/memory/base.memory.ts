import type { ChatObject, Intent, SessionObject } from "@/types/memory";

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
	getSession(sessionId: string): Promise<SessionObject | undefined>;
	createSession(sessionId: string): Promise<void>;
	addChatToSession(sessionId: string, chat: ChatObject): Promise<void>;
	deleteSession(sessionId: string): Promise<void>;
	listSessions(): Promise<string[]>;
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
