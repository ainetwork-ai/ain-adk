import type { Document, DocumentFilter, DocumentSlot } from "@/types/document";
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
	/**
	 * Document storage. Optional for backward compatibility — memory
	 * implementations that predate documents may omit it.
	 */
	getDocumentMemory?(): IDocumentMemory;
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
	getDocumentAdvicePrompt?(): Promise<string>;
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

/**
 * Document memory interface - handles document persistence.
 *
 * Documents are first-class, mutable entities referenced from threads.
 */
export interface IDocumentMemory {
	getDocument(documentId: string): Promise<Document | undefined>;
	createDocument(document: Document): Promise<Document>;
	updateDocument(
		documentId: string,
		document: Partial<Document>,
	): Promise<void>;
	/**
	 * Atomically patch a single slot of a document. Concurrent fills of
	 * different slots must not clobber each other, so implementations MUST
	 * target only the matched slot (e.g. Mongo's positional `$` operator)
	 * rather than rewriting the whole `slots` array from a caller snapshot,
	 * and MUST bump `version`/`updatedAt` in the same write. Keys whose value
	 * is `undefined` are removed from the slot.
	 */
	updateDocumentSlot(
		documentId: string,
		slotId: string,
		patch: Partial<DocumentSlot>,
	): Promise<void>;
	deleteDocument(documentId: string): Promise<void>;
	listDocuments(userId?: string, filter?: DocumentFilter): Promise<Document[]>;
}
