import type { MemoryModule } from "@/modules";
import { MessageRole, type ThreadObject } from "@/types/memory";
import { renderDocument } from "@/utils/document-render";
import { loggers } from "@/utils/logger";
import { createTextMessage } from "@/utils/thread-messages";

const ATTACHED_DOCUMENTS_FOOTER = `---
위 첨부 문서는 사용자가 이 대화에 참조용으로 첨부한 것이다. 문서의 서술 내용에 대한 질문에는 이 내용을 근거로 답하라. 단, 최신 수치·집계·조회가 필요한 질문에는 문서의 숫자를 그대로 답하지 말고 사용 가능한 도구를 사용하라.`;

/**
 * Collects attached document ids for the current turn: ids recorded on
 * earlier messages' `metadata.documentIds` (chronological), then the current
 * request's ids. Deduped, order-preserving.
 */
export function collectAttachedDocumentIds(
	thread: ThreadObject,
	requestDocumentIds?: string[],
): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const add = (id: unknown) => {
		if (typeof id === "string" && id && !seen.has(id)) {
			seen.add(id);
			ids.push(id);
		}
	};
	for (const message of thread.messages) {
		const metaIds = message.metadata?.documentIds;
		if (Array.isArray(metaIds)) {
			for (const id of metaIds) add(id);
		}
	}
	for (const id of requestDocumentIds ?? []) add(id);
	return ids;
}

/**
 * Resolves the attached documents to fresh rendered text and pushes ONE
 * in-memory USER message onto `thread.messages` so fulfillment sees the
 * bodies. Never persisted — intent triggering (which runs before this) and
 * stored history keep only the short display text.
 *
 * Isolation point: if the injection strategy changes (system-prompt
 * grounding, provider-native document parts), only this function changes.
 *
 * Authorization: resolution is deliberately read-open — ids are resolved via
 * `getDocument` without a per-user ownership check, matching the deployment's
 * role-based read-open document policy (cross-user document conversations are
 * a supported flow). Deployments that need owner-only attachment must enforce
 * authorization before passing ids into the query pipeline.
 */
export async function injectAttachedDocuments(
	memoryModule: MemoryModule,
	thread: ThreadObject,
	requestDocumentIds?: string[],
	filterText?: (text: string) => Promise<string>,
): Promise<void> {
	const documentIds = collectAttachedDocumentIds(thread, requestDocumentIds);
	if (documentIds.length === 0) return;

	const documentMemory = memoryModule.getDocumentMemory();
	if (!documentMemory) {
		loggers.intent.warn(
			"Attached documents requested but document memory is not configured",
			{ documentIds },
		);
		return;
	}

	const sections: string[] = [];
	for (let i = 0; i < documentIds.length; i++) {
		const id = documentIds[i];
		const label = `[첨부 문서 ${i + 1}]`;
		let document: Awaited<ReturnType<typeof documentMemory.getDocument>>;
		try {
			document = await documentMemory.getDocument(id);
		} catch (error) {
			loggers.intent.warn("Failed to resolve attached document", { id, error });
		}
		if (!document) {
			sections.push(
				`${label} '${id}' — 문서를 찾을 수 없음(삭제되었을 수 있음). 사용자에게 이 사실을 알려라.`,
			);
			continue;
		}

		let rendered = renderDocument(document);
		if (filterText) rendered = await filterText(rendered);
		sections.push(
			`${label} 제목: ${document.title} (최종 수정: ${document.updatedAt})\n${rendered}`,
		);

		const advice = document.advice?.content?.trim();
		if (advice) {
			sections.push(
				`${label.slice(0, -1)} - AI advice]\n${filterText ? await filterText(advice) : advice}`,
			);
		}
	}
	sections.push(ATTACHED_DOCUMENTS_FOOTER);

	thread.messages.push(
		createTextMessage(MessageRole.USER, sections.join("\n\n")),
	);
}
