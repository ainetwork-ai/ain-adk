import { randomUUID } from "node:crypto";
import type { MemoryModule } from "@/modules";
import type {
	CanonicalMessageObject,
	MessageContentPart,
	MessagePart,
	MessageRole,
	ThreadObject,
} from "@/types/memory";

/**
 * Canonical (schemaVersion 2) write helpers for thread messages. Legacy
 * `content`-shaped records are still readable through the normalization
 * adapters in `utils/message`, but all new writes converge here.
 *
 * Note: `utils/message` also exports a `createTextMessage` with an
 * object-style signature; these positional helpers exist for the
 * persist-to-thread call sites.
 */
export function createTextMessage(
	role: MessageRole,
	content: string,
	metadata?: Record<string, unknown>,
	messageId?: string,
): CanonicalMessageObject {
	return {
		messageId: messageId ?? randomUUID(),
		schemaVersion: 2,
		role,
		timestamp: Date.now(),
		parts: [{ kind: "text", text: content }],
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
	messageId?: string,
): Promise<CanonicalMessageObject> {
	const message = createTextMessage(role, content, metadata, messageId);
	thread.messages.push(message);
	await memoryModule
		.getThreadMemory()
		?.addMessagesToThread(thread.userId, thread.threadId, [message]);
	return message;
}

function toCanonicalPart(part: MessagePart): MessageContentPart {
	if (part.type === "document") {
		return { kind: "document", documentId: part.documentId, title: part.title };
	}
	return { kind: "text", text: part.text };
}

/**
 * Creates a "rich" message mixing text and document-reference parts.
 *
 * Parts are rendered in order by the client. Document parts carry only a
 * `documentId` (and optional label `title`) — the body is resolved on demand.
 */
export function createRichMessage(
	role: MessageRole,
	parts: MessagePart[],
	metadata?: Record<string, unknown>,
	messageId?: string,
): CanonicalMessageObject {
	return {
		messageId: messageId ?? randomUUID(),
		schemaVersion: 2,
		role,
		timestamp: Date.now(),
		parts: parts.map(toCanonicalPart),
		metadata,
	};
}

export async function appendRichMessageToThread(
	memoryModule: MemoryModule,
	thread: ThreadObject,
	role: MessageRole,
	parts: MessagePart[],
	metadata?: Record<string, unknown>,
	messageId?: string,
): Promise<CanonicalMessageObject> {
	const message = createRichMessage(role, parts, metadata, messageId);
	thread.messages.push(message);
	await memoryModule
		.getThreadMemory()
		?.addMessagesToThread(thread.userId, thread.threadId, [message]);
	return message;
}
