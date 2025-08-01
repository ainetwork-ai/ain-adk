import type {
	IAgentMemory,
	IIntentMemory,
	ISessionMemory,
} from "./base.memory.js";

export interface MemoryConfig {
	agent?: IAgentMemory;
	session?: ISessionMemory;
	intent?: IIntentMemory;
}

export class MemoryModule {
	private agentMemory?: IAgentMemory;
	private sessionMemory?: ISessionMemory;
	private intentMemory?: IIntentMemory;

	constructor(config: MemoryConfig) {
		this.agentMemory = config.agent;
		this.sessionMemory = config.session;
		this.intentMemory = config.intent;
	}

	async initialize(): Promise<void> {
		const connectPromises: Promise<void>[] = [];

		if (this.agentMemory) {
			connectPromises.push(this.agentMemory.connect());
		}
		if (this.sessionMemory) {
			connectPromises.push(this.sessionMemory.connect());
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
		if (this.sessionMemory?.isConnected()) {
			disconnectPromises.push(this.sessionMemory.disconnect());
		}
		if (this.intentMemory?.isConnected()) {
			disconnectPromises.push(this.intentMemory.disconnect());
		}

		await Promise.all(disconnectPromises);
	}

	public getAgentMemory(): IAgentMemory | undefined {
		return this.agentMemory;
	}

	public getSessionMemory(): ISessionMemory | undefined {
		return this.sessionMemory;
	}

	public getIntentMemory(): IIntentMemory | undefined {
		return this.intentMemory;
	}
}
