import type {
	Intent,
	MessageObject,
	ThreadFilter,
	ThreadMetadata,
	ThreadObject,
	ThreadType,
	UserWorkflow,
	WorkflowTemplate,
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
	getWorkflowTemplateMemory(): IWorkflowTemplateMemory;
	getUserWorkflowMemory(): IUserWorkflowMemory;
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
		workflowId?: string,
	): Promise<ThreadObject>;
	addMessagesToThread(
		userId: string,
		threadId: string,
		messages: MessageObject[],
	): Promise<void>;
	deleteThread(userId: string, threadId: string): Promise<void>;
	listThreads(userId: string, filter?: ThreadFilter): Promise<ThreadMetadata[]>;
	updateThreadPin(
		userId: string,
		threadId: string,
		isPinned: boolean,
	): Promise<void>;
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
	updateAgentPrompt?(prompt: string): Promise<void>;
	getAggregatePrompt?(): Promise<string>;
	getGenerateTitlePrompt?(): Promise<string>;
	getSingleTriggerPrompt?(): Promise<string>;
	getMultiTriggerPrompt?(): Promise<string>;
	getToolSelectPrompt?(): Promise<string>;
	getPIIFilterPrompt?(): Promise<string>;
	getPIIDetectPrompt?(): Promise<string>;
}

/**
 * Workflow template memory interface - handles template operations
 */
export interface IWorkflowTemplateMemory {
	getTemplate(templateId: string): Promise<WorkflowTemplate | undefined>;
	createTemplate(template: WorkflowTemplate): Promise<WorkflowTemplate>;
	updateTemplate(
		templateId: string,
		template: Partial<WorkflowTemplate>,
	): Promise<void>;
	deleteTemplate(templateId: string): Promise<void>;
	listTemplates(): Promise<WorkflowTemplate[]>;
}

/**
 * User workflow memory interface - handles user workflow and scheduling operations
 */
export interface IUserWorkflowMemory {
	getUserWorkflow(workflowId: string): Promise<UserWorkflow | undefined>;
	createUserWorkflow(workflow: UserWorkflow): Promise<UserWorkflow>;
	updateUserWorkflow(
		workflowId: string,
		workflow: Partial<UserWorkflow>,
	): Promise<void>;
	deleteUserWorkflow(workflowId: string, userId: string): Promise<void>;
	listUserWorkflows(userId?: string): Promise<UserWorkflow[]>;
	/** List all active scheduled workflows across all users (used by scheduler) */
	listActiveScheduledWorkflows(): Promise<UserWorkflow[]>;
}
