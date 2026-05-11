import type { MemoryModule } from "@/modules";
import type {
	MessageObject,
	ThreadMetadata,
	ThreadObject,
	ThreadType,
} from "@/types/memory";
import { normalizeMessageObject, normalizeThreadObject } from "@/utils/message";

export class ThreadService {
	private memoryModule: MemoryModule;

	constructor(memoryModule: MemoryModule) {
		this.memoryModule = memoryModule;
	}

	public async getThread(
		userId: string,
		threadId: string,
	): Promise<ThreadObject | undefined> {
		const threadMemory = this.memoryModule.getThreadMemory();
		if (!threadMemory) {
			return;
		}

		const thread = await threadMemory.getThread(userId, threadId);
		return thread ? normalizeThreadObject(thread) : undefined;
	}

	public async createThread(
		type: ThreadType,
		userId: string,
		threadId: string,
		title: string,
	): Promise<ThreadObject> {
		const threadMemory = this.memoryModule.getThreadMemory();
		if (!threadMemory) {
			return {
				type,
				userId,
				threadId,
				title,
				messages: [],
			};
		}

		const metadata: ThreadMetadata = await threadMemory.createThread(
			type,
			userId,
			threadId,
			title,
		);
		return { ...metadata, messages: [] };
	}

	public async addMessagesToThread(
		userId: string,
		threadId: string,
		messages: Array<MessageObject>,
	): Promise<void> {
		const threadMemory = this.memoryModule.getThreadMemory();
		if (!threadMemory) {
			return;
		}

		await threadMemory.addMessagesToThread(
			userId,
			threadId,
			messages.map(normalizeMessageObject),
		);
	}
}
