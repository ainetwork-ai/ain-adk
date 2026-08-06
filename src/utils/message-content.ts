import type { MessageObject } from "@/types/memory";

/**
 * Flattens a stored message's content into prompt text.
 *
 * `MessageContentObject.parts` is `unknown[]` and its shape depends on
 * `content.type` — `"text"` holds plain strings, while `"rich"`/`"document"`
 * hold {@link MessagePart} OBJECTS. Model providers must never hand one of
 * those objects to a chat API as `content`: OpenAI-compatible endpoints reject
 * the whole request with `400 Invalid type for 'messages[N].content'`, which
 * breaks every later turn in the thread because the message is persisted.
 *
 * Document parts render as a short label only. The body is not inlined here —
 * `injectAttachedDocuments` resolves it to fresh text once per turn, so
 * embedding a (possibly stale) copy per history entry would duplicate it.
 *
 * Total function: returns `""` for empty, unknown or malformed content rather
 * than leaking a non-string value.
 */
export function messageToPromptText(message: MessageObject): string {
	const parts = message?.content?.parts;
	if (!Array.isArray(parts)) return "";

	const rendered: string[] = [];
	for (const part of parts) {
		if (typeof part === "string") {
			if (part) rendered.push(part);
			continue;
		}
		if (!part || typeof part !== "object") continue;

		const { type, text, documentId, title } = part as Record<string, unknown>;
		if (type === "text" && typeof text === "string") {
			if (text) rendered.push(text);
			continue;
		}
		if (type === "document" && typeof documentId === "string") {
			const label =
				typeof title === "string" && title.trim() ? title : documentId;
			rendered.push(`[문서: ${label}]`);
		}
		// Unknown part shape: skipped on purpose — dropping a segment is
		// recoverable, emitting an object is a hard 400.
	}
	return rendered.join("\n");
}
