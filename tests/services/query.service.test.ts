import type { MemoryModule, ModelModule } from "@/modules";
import type { IntentFulfillService } from "@/services/intents/fulfill.service";
import type { IntentTriggerService } from "@/services/intents/trigger.service";
import { QueryService } from "@/services/query.service";
import { MessageRole, type ThreadObject, ThreadType } from "@/types/memory";
import { createTextMessage } from "@/utils/message";

describe("QueryService", () => {
	it("creates a new thread and returns the final message for an initial query without threadId", async () => {
		const createThread = jest.fn(async (_type, _userId, threadId, title) => ({
			type: ThreadType.CHAT,
			userId: "user-1",
			threadId,
			title,
		}));
		const addMessagesToThread = jest.fn(async () => {});
		const getThread = jest.fn(async () => undefined);
		const intentFulfill = jest.fn(async function* () {
			return createTextMessage({
				messageId: "model-msg-1",
				role: MessageRole.MODEL,
				timestamp: 456,
				text: "hi there",
			});
		});

		const queryService = new QueryService(
			{
				getModel: () => ({
					generateMessages: () => [],
					fetch: async () => ({ content: "New Chat" }),
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getThreadMemory: () => ({
					getThread,
					createThread,
					addMessagesToThread,
				}),
			} as any,
			{
				intentTriggering: async () => ({
					intents: [{ subquery: "hello there" }],
					needsAggregation: false,
				}),
			} as any,
			{
				intentFulfill,
			} as any,
		);

		const stream = queryService.handleQuery(
			{
				type: ThreadType.CHAT,
				userId: "user-1",
			},
			{
				query: "hello there",
			},
		);

		const first = await stream.next();
		expect(first.done).toBe(false);
		expect(first.value).toMatchObject({
			event: "thread_id",
			data: {
				type: ThreadType.CHAT,
				userId: "user-1",
				title: "New Chat",
			},
		});

		if (first.done || first.value.event !== "thread_id") {
			throw new Error("Expected initial thread_id event");
		}

		const createdThreadId = first.value.data.threadId;
		expect(createdThreadId).toBeTruthy();
		expect(createThread).toHaveBeenCalledWith(
			ThreadType.CHAT,
			"user-1",
			createdThreadId,
			"New Chat",
			undefined,
		);

		const second = await stream.next();
		expect(second.done).toBe(true);
		expect(second.value).toEqual(
			createTextMessage({
				messageId: "model-msg-1",
				role: MessageRole.MODEL,
				timestamp: 456,
				text: "hi there",
			}),
		);

		expect(addMessagesToThread).toHaveBeenCalledTimes(1);
		expect(addMessagesToThread).toHaveBeenCalledWith(
			"user-1",
			createdThreadId,
			[
				expect.objectContaining({
					role: MessageRole.USER,
					schemaVersion: 2,
					parts: [{ kind: "text", text: "hello there" }],
				}),
			],
		);
		expect(intentFulfill).toHaveBeenCalledWith(
			[{ subquery: "hello there" }],
			expect.objectContaining({ threadId: createdThreadId }),
			"hello there",
			false,
			expect.objectContaining({
				role: MessageRole.USER,
				schemaVersion: 2,
				parts: [{ kind: "text", text: "hello there" }],
			}),
		);
	});

	it("passes structured query input to fulfillment as canonical model input", async () => {
		const intentFulfill = jest.fn(async function* () {
			return createTextMessage({
				messageId: "model-msg-2",
				role: MessageRole.MODEL,
				timestamp: 789,
				text: "done",
			});
		});

		const queryService = new QueryService(
			{
				getModel: () => ({
					generateMessages: () => [],
					fetch: async () => ({ content: "New Chat" }),
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getThreadMemory: () => ({
					getThread: jest.fn(async () => ({
						type: ThreadType.CHAT,
						userId: "user-1",
						threadId: "thread-1",
						title: "Thread",
						messages: [],
					})),
					addMessagesToThread: jest.fn(async () => {}),
				}),
			} as any,
			{
				intentTriggering: async () => ({
					intents: [{ subquery: "summarize" }],
					needsAggregation: false,
				}),
			} as any,
			{
				intentFulfill,
			} as any,
		);

		const stream = queryService.handleQuery(
			{
				type: ThreadType.CHAT,
				userId: "user-1",
				threadId: "thread-1",
			},
			{
				query: "Summarize this\nfile preview",
				input: {
					parts: [
						{ kind: "text", text: "Summarize this" },
						{
							kind: "artifact",
							artifactId: "art-1",
							previewText: "file preview",
						},
					],
				},
			},
		);

		await expect(stream.next()).resolves.toMatchObject({
			done: true,
		});
		expect(intentFulfill).toHaveBeenCalledWith(
			[{ subquery: "summarize" }],
			expect.objectContaining({ threadId: "thread-1" }),
			"Summarize this\nfile preview",
			false,
			expect.objectContaining({
				role: MessageRole.USER,
				schemaVersion: 2,
				parts: [
					{ kind: "text", text: "Summarize this" },
					expect.objectContaining({
						kind: "artifact",
						artifactId: "art-1",
						previewText: "file preview",
					}),
				],
			}),
			);
		});

	it("normalizes legacy stored thread messages before intent processing", async () => {
		const intentTriggering = jest.fn(async () => ({
			intents: [{ subquery: "next question" }],
			needsAggregation: false,
		}));
		const intentFulfill = jest.fn(async function* () {
			return createTextMessage({
				messageId: "model-msg-3",
				role: MessageRole.MODEL,
				timestamp: 900,
				text: "done",
			});
		});

		const queryService = new QueryService(
			{
				getModel: () => ({
					generateMessages: () => [],
					fetch: async () => ({ content: "New Chat" }),
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getThreadMemory: () => ({
					getThread: jest.fn(async () => ({
						type: ThreadType.CHAT,
						userId: "user-1",
						threadId: "thread-1",
						title: "Thread",
						messages: [
							{
								messageId: "legacy-msg-1",
								role: MessageRole.USER,
								timestamp: 100,
								content: {
									type: "text",
									parts: ["legacy hello"],
								},
							},
						],
					})),
					addMessagesToThread: jest.fn(async () => {}),
				}),
			} as any,
			{
				intentTriggering,
			} as any,
			{
				intentFulfill,
			} as any,
		);

		const stream = queryService.handleQuery(
			{
				type: ThreadType.CHAT,
				userId: "user-1",
				threadId: "thread-1",
			},
			{
				query: "next question",
			},
		);

		await expect(stream.next()).resolves.toMatchObject({
			done: true,
		});
		expect(intentTriggering).toHaveBeenCalledWith(
			"next question",
			expect.objectContaining({
				messages: [
					{
						messageId: "legacy-msg-1",
						role: MessageRole.USER,
						timestamp: 100,
						metadata: undefined,
						schemaVersion: 2,
						parts: [{ kind: "text", text: "legacy hello" }],
					},
				],
			}),
		);
		expect(intentFulfill).toHaveBeenCalledWith(
			[{ subquery: "next question" }],
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						schemaVersion: 2,
						parts: [{ kind: "text", text: "legacy hello" }],
					}),
				],
			}),
			"next question",
			false,
			expect.objectContaining({
				schemaVersion: 2,
			}),
		);
	});
});

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
