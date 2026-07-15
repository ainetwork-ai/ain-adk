import type { MemoryModule, ModelModule } from "@/modules";
import { QueryService } from "@/services/query.service";
import type { IntentFulfillService } from "@/services/intents/fulfill.service";
import type { IntentTriggerService } from "@/services/intents/trigger.service";
import { MessageRole, type ThreadObject, ThreadType } from "@/types/memory";

const document = {
	documentId: "doc-1",
	userId: "u1",
	title: "파빌리온 2026-07-12",
	format: "MARKDOWN",
	content: "일지 본문입니다.",
	source: "MANUAL",
	version: 1,
	createdAt: "t0",
	updatedAt: "t1",
};

function makeHarness() {
	const thread: ThreadObject = {
		type: ThreadType.CHAT,
		userId: "u1",
		threadId: "t1",
		title: "T",
		messages: [],
	} as unknown as ThreadObject;

	const addMessagesToThread = jest.fn(async () => undefined);
	const memoryModule = {
		getThreadMemory: () => ({
			getThread: jest.fn(async () => thread),
			addMessagesToThread,
		}),
		getDocumentMemory: () => ({ getDocument: jest.fn(async () => document) }),
	} as unknown as MemoryModule;

	const intentTriggerService = {
		intentTriggering: jest.fn(async () => ({
			intents: [{ subquery: "재작성된 짧은 질문" }],
			needsAggregation: false,
		})),
	} as unknown as IntentTriggerService;

	let messagesSnapshotAtTrigger: number | undefined;
	(intentTriggerService.intentTriggering as jest.Mock).mockImplementation(
		async () => {
			messagesSnapshotAtTrigger = thread.messages.length;
			return {
				intents: [{ subquery: "재작성된 짧은 질문" }],
				needsAggregation: false,
			};
		},
	);

	let threadMessagesAtFulfill: string[] = [];
	const intentFulfillService = {
		intentFulfill: jest.fn((_intents, fulfillThread: ThreadObject) => {
			threadMessagesAtFulfill = fulfillThread.messages.map(
				(m) => m.content.parts[0] as string,
			);
			return (async function* () {})();
		}),
	} as unknown as IntentFulfillService;

	const service = new QueryService(
		{} as unknown as ModelModule, // 기존 스레드 → generateTitle 미호출
		memoryModule,
		intentTriggerService,
		intentFulfillService,
	);

	return {
		service,
		thread,
		addMessagesToThread,
		intentFulfillService,
		getMessagesSnapshotAtTrigger: () => messagesSnapshotAtTrigger,
		getThreadMessagesAtFulfill: () => threadMessagesAtFulfill,
	};
}

async function drain(gen: AsyncGenerator<unknown>) {
	for await (const _ of gen) {
		// drain
	}
}

describe("QueryService.handleQuery with documentIds", () => {
	it("persists documentIds on the user message metadata", async () => {
		const h = makeHarness();
		await drain(
			h.service.handleQuery(
				{ type: ThreadType.CHAT, userId: "u1", threadId: "t1" },
				{
					query: "문서를 참고해서 답해줘.",
					displayQuery: "로그북에 대해 대화해보기",
					documentIds: ["doc-1"],
				},
			),
		);
		const persisted = h.addMessagesToThread.mock.calls[0][2][0];
		expect(persisted.role).toBe(MessageRole.USER);
		expect(persisted.metadata.documentIds).toEqual(["doc-1"]);
	});

	it("injects document context after triggering, before fulfillment", async () => {
		const h = makeHarness();
		await drain(
			h.service.handleQuery(
				{ type: ThreadType.CHAT, userId: "u1", threadId: "t1" },
				{
					query: "문서를 참고해서 답해줘.",
					displayQuery: "로그북에 대해 대화해보기",
					documentIds: ["doc-1"],
				},
			),
		);
		// 트리거 시점에는 주입 전 (히스토리 0개)
		expect(h.getMessagesSnapshotAtTrigger()).toBe(0);
		// fulfillment 시점에는 문서 블록이 스레드에 존재
		const joined = h.getThreadMessagesAtFulfill().join("\n");
		expect(joined).toContain("일지 본문입니다.");
		expect(joined).toContain("[첨부 문서 1] 제목: 파빌리온 2026-07-12");
	});

	it("does not inject anything without documentIds (regression)", async () => {
		const h = makeHarness();
		await drain(
			h.service.handleQuery(
				{ type: ThreadType.CHAT, userId: "u1", threadId: "t1" },
				{ query: "그냥 일반 질문" },
			),
		);
		expect(h.getThreadMessagesAtFulfill()).toEqual([]);
		const persisted = h.addMessagesToThread.mock.calls[0][2][0];
		expect(persisted.metadata.documentIds).toBeUndefined();
	});

	it("ignores a non-array documentIds value from the request body", async () => {
		const h = makeHarness();
		await drain(
			h.service.handleQuery(
				{ type: ThreadType.CHAT, userId: "u1", threadId: "t1" },
				{
					query: "질문",
					// simulates a malformed, untyped request body
					documentIds: "abc" as unknown as string[],
				},
			),
		);
		expect(h.getThreadMessagesAtFulfill()).toEqual([]);
		const persisted = h.addMessagesToThread.mock.calls[0][2][0];
		expect(persisted.metadata.documentIds).toBeUndefined();
	});
});
