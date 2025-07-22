import type { ChatObject, SessionObject } from "@/types/memory.js";

/**
 * Abstract base class for memory storage implementations.
 *
 * Provides an interface for storing and retrieving conversation history
 * and query-intent pairs. Implementations can use various backends
 * such as in-memory storage, databases, or file systems.
 */
export abstract class BaseMemory {
	/**
	 * Retrieves the conversation history for a specific session.
	 *
	 * @param sessionId - Unique identifier for the session
	 * @returns Promise resolving to the session's conversation history
	 */
	abstract getSessionHistory(sessionId: string): Promise<SessionObject>;
	/**
	 * Adds a new chat message to the session history.
	 *
	 * @param sessionId - Unique identifier for the session
	 * @param chat - The chat object to add to the history
	 */
	abstract updateSessionHistory(
		sessionId: string,
		chat: ChatObject,
	): Promise<void>;
	/**
	 * Stores a query-intent pair for analysis or training purposes.
	 *
	 * @param query - The user's input query
	 * @param intent - The detected intent for the query
	 * @param sessionId - Unique identifier for the session
	 */
	abstract storeQueryAndIntent(
		query: string,
		intent: string,
		sessionId: string,
	): Promise<void>;
}

/**
 * Module wrapper for memory storage implementations.
 *
 * Provides a consistent interface for accessing memory storage
 * functionality throughout the application. Currently supports
 * a single memory implementation but designed for future extensibility.
 *
 * @example
 * ```typescript
 * const inMemoryStorage = new InMemoryStorage();
 * const memoryModule = new MemoryModule(inMemoryStorage);
 *
 * const memory = memoryModule.getMemory();
 * await memory.updateSessionHistory("session-123", chatMessage);
 * ```
 */
export class MemoryModule {
	/** The memory storage implementation */
	private memory: BaseMemory;

	/**
	 * Creates a new MemoryModule with the specified storage implementation.
	 *
	 * @param memory - The memory storage implementation to use
	 */
	constructor(memory: BaseMemory) {
		this.memory = memory;
	}

	/**
	 * Returns the current memory storage implementation.
	 *
	 * @returns The active memory storage instance
	 */
	public getMemory() {
		// TODO: Support multi-memory for each type of memory?
		return this.memory;
	}
}
