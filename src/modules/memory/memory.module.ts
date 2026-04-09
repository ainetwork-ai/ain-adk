import type {
	IAgentMemory,
	IIntentMemory,
	IMemory,
	IThreadMemory,
	IUserWorkflowMemory,
	IWorkflowTemplateMemory,
} from "./base.memory.js";

export class MemoryModule {
	private memory: IMemory;

	constructor(memory: IMemory) {
		this.memory = memory;
	}

	async initialize(): Promise<void> {
		await this.memory.connect();
	}

	async shutdown(): Promise<void> {
		if (this.memory.isConnected()) {
			await this.memory.disconnect();
		}
	}

	public getAgentMemory(): IAgentMemory {
		return this.memory.getAgentMemory();
	}

	public getThreadMemory(): IThreadMemory {
		return this.memory.getThreadMemory();
	}

	public getIntentMemory(): IIntentMemory {
		return this.memory.getIntentMemory();
	}

	public getWorkflowTemplateMemory(): IWorkflowTemplateMemory {
		return this.memory.getWorkflowTemplateMemory();
	}

	public getUserWorkflowMemory(): IUserWorkflowMemory {
		return this.memory.getUserWorkflowMemory();
	}
}
