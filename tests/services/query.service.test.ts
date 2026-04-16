import { QueryService } from "@/services/query.service";
import { createTextMessage } from "@/utils/message";
import { MessageRole, ThreadType } from "@/types/memory";

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
});
