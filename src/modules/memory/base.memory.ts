import type {
	Intent,
	MessageObject,
	ThreadMetadata,
	ThreadObject,
	ThreadType,
	Workflow,
} from "@/types/memory";

/**
 * Memory connection interface - manages the underlying connection
 */
export interface IMemory {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	isConnected(): boolean;
	getThreadMemory(): IThreadMemory;
	getIntentMemory(): IIntentMemory;
	getAgentMemory(): IAgentMemory;
	getWorkflowMemory(): IWorkflowMemory;
}

/**
 * Thread memory interface - handles thread operations
 */
export interface IThreadMemory {
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
 * Intent memory interface - handles intent operations
 */
export interface IIntentMemory {
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
export interface IAgentMemory {
	getAgentPrompt(): Promise<string>;
	updateAgentPrompt(prompt: string): Promise<void>;
}

/**
 * Workflow memory interface - handles workflow operations
 */
export interface IWorkflowMemory {
	getWorkflow(workflowId: string): Promise<Workflow | undefined>;
	createWorkflow(workflow: Workflow): Promise<Workflow>;
	updateWorkflow(
		workflowId: string,
		workflow: Partial<Workflow>,
	): Promise<void>;
	deleteWorkflow(workflowId: string, userId: string): Promise<void>;
	listWorkflows(userId?: string): Promise<Workflow[]>;
}
