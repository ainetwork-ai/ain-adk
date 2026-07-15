import type { MemoryModule } from "@/modules";
import { MessageRole, type ThreadObject } from "@/types/memory";
import {
	collectAttachedDocumentIds,
	injectAttachedDocuments,
} from "@/utils/attached-documents";

function makeThread(
	messages: Array<{ metadata?: Record<string, unknown> }> = [],
): ThreadObject {
	return {
		type: "CHAT",
		userId: "u1",
		threadId: "t1",
		title: "T",
		messages: messages.map((m, i) => ({
			messageId: `m${i}`,
			role: MessageRole.USER,
			timestamp: i,
			content: { type: "text", parts: ["msg"] },
			metadata: m.metadata,
		})),
	} as unknown as ThreadObject;
}

const baseDocument = {
	documentId: "doc-1",
	userId: "u1",
	title: "파빌리온 2026-07-12",
	format: "MARKDOWN",
	content: "## 매출\n{{slot:rev}}\n",
	slots: [
		{
			slotId: "rev",
			status: "resolved",
			fragment: {
				content: "총매출 100만원",
				source: { type: "QUERY", query: "" },
				resolvedAt: "t",
			},
		},
	],
	advice: { content: "재고를 확인하세요.", generatedAt: "t" },
	source: "MANUAL",
	version: 1,
	createdAt: "t0",
	updatedAt: "2026-07-13T09:00:00Z",
};

function makeMemory(
	getDocument = jest.fn(async () => baseDocument),
	hasDocumentMemory = true,
) {
	const addMessagesToThread = jest.fn(async () => undefined);
	const memoryModule = {
		getDocumentMemory: () => (hasDocumentMemory ? { getDocument } : undefined),
		getThreadMemory: () => ({ addMessagesToThread }),
	} as unknown as MemoryModule;
	return { memoryModule, getDocument, addMessagesToThread };
}

describe("collectAttachedDocumentIds", () => {
	it("collects history ids first, then request ids, deduped", () => {
		const thread = makeThread([
			{ metadata: { documentIds: ["doc-a"] } },
			{ metadata: {} },
			{ metadata: { documentIds: ["doc-b", "doc-a"] } },
		]);
		expect(collectAttachedDocumentIds(thread, ["doc-c", "doc-b"])).toEqual([
			"doc-a",
			"doc-b",
			"doc-c",
		]);
	});

	it("ignores non-array or non-string metadata values", () => {
		const thread = makeThread([
			{ metadata: { documentIds: "not-array" } },
			{ metadata: { documentIds: [42, "", "doc-a"] } },
		]);
		expect(collectAttachedDocumentIds(thread)).toEqual(["doc-a"]);
	});

	it("returns empty for a thread with no attachments", () => {
		expect(collectAttachedDocumentIds(makeThread())).toEqual([]);
	});
});

describe("injectAttachedDocuments", () => {
	it("pushes one in-memory USER message with rendered body, advice and framing footer", async () => {
		const { memoryModule, addMessagesToThread } = makeMemory();
		const thread = makeThread();

		await injectAttachedDocuments(memoryModule, thread, ["doc-1"]);

		expect(thread.messages).toHaveLength(1);
		const injected = thread.messages[0];
		expect(injected.role).toBe(MessageRole.USER);
		const text = injected.content.parts[0] as string;
		expect(text).toContain("[첨부 문서 1] 제목: 파빌리온 2026-07-12");
		expect(text).toContain("총매출 100만원"); // slot resolved via renderDocument
		expect(text).toContain("재고를 확인하세요."); // advice
		expect(text).toContain("사용 가능한 도구를 사용하라"); // framing footer
		// in-memory only — never persisted
		expect(addMessagesToThread).not.toHaveBeenCalled();
	});

	it("is a no-op when there are no document ids", async () => {
		const { memoryModule } = makeMemory();
		const thread = makeThread();
		await injectAttachedDocuments(memoryModule, thread, []);
		await injectAttachedDocuments(memoryModule, thread, undefined);
		expect(thread.messages).toHaveLength(0);
	});

	it("is a no-op when document memory is not configured", async () => {
		const { memoryModule } = makeMemory(jest.fn(), false);
		const thread = makeThread();
		await injectAttachedDocuments(memoryModule, thread, ["doc-1"]);
		expect(thread.messages).toHaveLength(0);
	});

	it("emits a not-found block when a document is missing or lookup throws", async () => {
		const getDocument = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("boom"));
		const { memoryModule } = makeMemory(getDocument);
		const thread = makeThread();

		await injectAttachedDocuments(memoryModule, thread, ["gone-1", "gone-2"]);

		const text = thread.messages[0].content.parts[0] as string;
		expect(text).toContain("[첨부 문서 1] 'gone-1' — 문서를 찾을 수 없음");
		expect(text).toContain("[첨부 문서 2] 'gone-2' — 문서를 찾을 수 없음");
	});

	it("re-collects ids from thread history metadata (follow-up turns)", async () => {
		const { memoryModule, getDocument } = makeMemory();
		const thread = makeThread([{ metadata: { documentIds: ["doc-1"] } }]);

		await injectAttachedDocuments(memoryModule, thread, undefined);

		expect(getDocument).toHaveBeenCalledWith("doc-1");
		expect(thread.messages).toHaveLength(2); // history msg + injected block
	});

	it("applies filterText to rendered body and advice when provided", async () => {
		const { memoryModule } = makeMemory();
		const thread = makeThread();
		const filterText = jest.fn(async (t: string) => t.replace(/100만원/g, "***"));

		await injectAttachedDocuments(memoryModule, thread, ["doc-1"], filterText);

		const text = thread.messages[0].content.parts[0] as string;
		expect(text).toContain("***");
		expect(text).not.toContain("100만원");
		expect(filterText).toHaveBeenCalledTimes(2); // body + advice
	});
});
