import { setManifest } from "@/config/manifest";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import { MessageRole, ThreadType } from "@/types/memory";

describe("IntentFulfillService", () => {
	beforeEach(() => {
		setManifest({
			name: "Test Agent",
			description: "Test agent",
		});
	});

	it("emits canonical message stream events alongside compatibility text chunks", async () => {
		const addMessagesToThread = jest.fn(async () => {});
		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages: () => [],
					convertToolsToFunctions: () => [],
					appendMessages: jest.fn(),
					fetchStreamWithContextMessage: async () => ({
						async *[Symbol.asyncIterator]() {
							yield {
								delta: {
									content: "streamed reply",
								},
							};
						},
					}),
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getAgentMemory: () => ({
					getAgentPrompt: async () => "",
				}),
				getThreadMemory: () => ({
					addMessagesToThread,
				}),
			} as any,
		);

		const stream = service.intentFulfill(
			[{ subquery: "hello there" }],
			{
				userId: "user-1",
				threadId: "thread-1",
				type: ThreadType.CHAT,
				title: "Thread",
				messages: [],
			},
			"hello there",
			false,
		);

		const events: string[] = [];
		const completedMessages: unknown[] = [];
		let finalMessage;

		while (true) {
			const result = await stream.next();
			if (result.done) {
				finalMessage = result.value;
				break;
			}
			events.push(result.value.event);
			if (result.value.event === "message_complete") {
				completedMessages.push(result.value.data.message);
			}
		}

		expect(events).toEqual([
			"thinking_process",
			"message_start",
			"part_delta",
			"text_chunk",
			"message_complete",
		]);
		expect(finalMessage).toMatchObject({
			role: MessageRole.MODEL,
			schemaVersion: 2,
			parts: [{ kind: "text", text: "streamed reply" }],
		});
		expect(completedMessages).toEqual([finalMessage]);
		expect(addMessagesToThread).toHaveBeenCalledWith(
			"user-1",
			"thread-1",
			[
				expect.objectContaining({
					messageId: finalMessage?.messageId,
					role: MessageRole.MODEL,
				}),
			],
		);
	});

	it("adds multi-intent intermediate results to context as canonical messages", async () => {
		let streamCallCount = 0;
		const generatedMessageInputs: Array<unknown[]> = [];
		const addMessagesToThread = jest.fn(async () => {});

		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages: ({ thread }: any) => {
						generatedMessageInputs.push(
							thread.messages.map((message: any) => ({
								role: message.role,
								schemaVersion: message.schemaVersion,
								parts: message.parts,
								metadata: message.metadata,
							})),
						);
						return [];
					},
					convertToolsToFunctions: () => [],
					appendMessages: jest.fn(),
					fetchStreamWithContextMessage: async () => {
						const response =
							streamCallCount === 0 ? "first reply" : "second reply";
						streamCallCount += 1;

						return {
							async *[Symbol.asyncIterator]() {
								yield {
									delta: {
										content: response,
									},
								};
							},
						};
					},
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getAgentMemory: () => ({
					getAgentPrompt: async () => "",
				}),
				getThreadMemory: () => ({
					addMessagesToThread,
				}),
			} as any,
		);

		const stream = service.intentFulfill(
			[{ subquery: "first" }, { subquery: "second" }],
			{
				userId: "user-1",
				threadId: "thread-1",
				type: ThreadType.CHAT,
				title: "Thread",
				messages: [],
			},
			"original query",
			false,
		);

		let finalMessage;
		while (true) {
			const result = await stream.next();
			if (result.done) {
				finalMessage = result.value;
				break;
			}
		}

		expect(generatedMessageInputs).toHaveLength(2);
		expect(generatedMessageInputs[1]).toEqual([
			expect.objectContaining({
				role: MessageRole.MODEL,
				schemaVersion: 2,
				parts: [{ kind: "text", text: "first reply" }],
				metadata: { isThinking: true },
			}),
		]);
		expect(finalMessage).toMatchObject({
			role: MessageRole.MODEL,
			schemaVersion: 2,
			parts: [{ kind: "text", text: "second reply" }],
		});
	});
});
