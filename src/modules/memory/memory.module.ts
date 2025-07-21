import type { ChatObject, SessionObject } from "@/types/memory.js";

export abstract class BaseMemory {
	abstract getSessionHistory(sessionId: string): Promise<SessionObject>;
	abstract updateSessionHistory(
		sessionId: string,
		chat: ChatObject,
	): Promise<void>;
	abstract storeQueryAndIntent(
		query: string,
		intent: string,
		sessionId: string,
	): Promise<void>;
	abstract getAgentPrompt(): Promise<string>;
	abstract getSystemPrompt(): Promise<string>;
	abstract updateAgentPrompt(newPrompt: string): Promise<void>;
}

export default class MemoryModule {
	private memory: BaseMemory;

	constructor(memory: BaseMemory) {
		this.memory = memory;
	}

	public getMemory() {
		// TODO: Support multi-memory for each type of memory?
		return this.memory;
	}
}
