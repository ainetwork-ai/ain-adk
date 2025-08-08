import type {
	IAgentMemory,
	IIntentMemory,
	IThreadMemory,
} from "./base.memory.js";

export interface MemoryConfig {
	agent?: IAgentMemory;
	thread?: IThreadMemory;
	intent?: IIntentMemory;
}

export class MemoryModule {
	private agentMemory?: IAgentMemory;
	private threadMemory?: IThreadMemory;
	private intentMemory?: IIntentMemory;

	constructor(config: MemoryConfig) {
		this.agentMemory = config.agent;
		this.threadMemory = config.thread;
		this.intentMemory = config.intent;
	}

	async initialize(): Promise<void> {
		const connectPromises: Promise<void>[] = [];

		if (this.agentMemory) {
			connectPromises.push(this.agentMemory.connect());
		}
		if (this.threadMemory) {
			connectPromises.push(this.threadMemory.connect());
		}
		if (this.intentMemory) {
			connectPromises.push(this.intentMemory.connect());
		}

		await Promise.all(connectPromises);
	}

	async shutdown(): Promise<void> {
		const disconnectPromises: Promise<void>[] = [];

		if (this.agentMemory?.isConnected()) {
			disconnectPromises.push(this.agentMemory.disconnect());
		}
		if (this.threadMemory?.isConnected()) {
			disconnectPromises.push(this.threadMemory.disconnect());
		}
		if (this.intentMemory?.isConnected()) {
			disconnectPromises.push(this.intentMemory.disconnect());
		}

		await Promise.all(disconnectPromises);
	}

	public getAgentMemory(): IAgentMemory | undefined {
		return this.agentMemory;
	}

	public getThreadMemory(): IThreadMemory | undefined {
		return this.threadMemory;
	}

	public getIntentMemory(): IIntentMemory | undefined {
		return this.intentMemory;
	}
}
