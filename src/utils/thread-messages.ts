import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules";
import type { MessageObject, MessageRole, ThreadObject } from "@/types/memory";

export function createTextMessage(
	role: MessageRole,
	content: string,
	metadata?: Record<string, unknown>,
): MessageObject {
	return {
		messageId: randomUUID(),
		role,
		timestamp: Date.now(),
		content: { type: "text", parts: [content] },
		metadata,
	};
}

export async function persistTextMessage(
	memoryModule: MemoryModule,
	userId: string,
	threadId: string,
	role: MessageRole,
	content: string,
	metadata?: Record<string, unknown>,
): Promise<void> {
	const message = createTextMessage(role, content, metadata);
	await memoryModule
		.getThreadMemory()
		?.addMessagesToThread(userId, threadId, [message]);
}

export async function appendTextMessageToThread(
	memoryModule: MemoryModule,
	thread: ThreadObject,
	role: MessageRole,
	content: string,
	metadata?: Record<string, unknown>,
): Promise<void> {
	const message = createTextMessage(role, content, metadata);
	thread.messages.push(message);
	await memoryModule
		.getThreadMemory()
		?.addMessagesToThread(thread.userId, thread.threadId, [message]);
}
