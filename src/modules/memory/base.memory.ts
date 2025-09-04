import type {
	Intent,
	MessageObject,
	ThreadMetadata,
	ThreadObject,
	ThreadType,
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
 * Thread memory interface
 */
export interface IThreadMemory extends IMemory {
	getThread(
		userId: string,
		threadId: string,
	): Promise<ThreadObject | undefined>;
	createThread(
		type: ThreadType,
		userId: string,
		threadId: string,
		title: string,
	): Promise<ThreadObject>;
	addMessagesToThread(
		userId: string,
		threadId: string,
		messages: MessageObject[],
	): Promise<void>;
	deleteThread(userId: string, threadId: string): Promise<void>;
	listThreads(userId: string): Promise<ThreadMetadata[]>;
}

/**
 * Intent memory interface
 */
export interface IIntentMemory extends IMemory {
	getIntent(intentId: string): Promise<Intent | undefined>;
	getIntentByName(intentName: string): Promise<Intent | undefined>;
	saveIntent(intent: Intent): Promise<void>;
	updateIntent(intentId: string, intent: Intent): Promise<void>;
	deleteIntent(intentId: string): Promise<void>;
	listIntents(): Promise<Intent[]>;
}

/**
 * Agent memory interface for storing agent configuration
 */
export interface IAgentMemory extends IMemory {}
