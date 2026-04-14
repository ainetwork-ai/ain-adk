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
		let finalMessage;

		while (true) {
			const result = await stream.next();
			if (result.done) {
				finalMessage = result.value;
				break;
			}
			events.push(result.value.event);
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
});
