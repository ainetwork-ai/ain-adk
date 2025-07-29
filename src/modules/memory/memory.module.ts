import { MemoryType } from "@/types/memory.js";
import type { BaseMemory } from "./base.memory.js";
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
	private memoryMap: Map<MemoryType, BaseMemory>;

	/**
	 * Creates a new MemoryModule with the specified storage implementation.
	 *
	 * @param memory - The memory storage implementation to use
	 */
	constructor(memory: BaseMemory) {
		this.memoryMap = new Map();
		this.memoryMap.set(MemoryType._DEFAULT, memory);
	}

	/**
	 * Returns the current memory storage implementation.
	 *
	 * @returns The active memory storage instance
	 */
	public getMemory(type?: MemoryType): BaseMemory | undefined {
		if (!type) {
			return this.memoryMap.get(MemoryType._DEFAULT);
		}

		const memory = this.memoryMap.get(type);
		if (!memory) {
			return this.memoryMap.get(MemoryType._DEFAULT);
		}
		return memory;
	}
}
