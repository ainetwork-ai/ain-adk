import { A2AService } from "@/services/a2a.service";
import { MessageRole, ThreadType } from "@/types/memory";
import { createTextMessage } from "@/utils/message";

describe("A2AService", () => {
	it("falls back to message_complete when compatibility text chunks are absent", async () => {
		const finalMessage = createTextMessage({
			messageId: "msg-1",
			role: MessageRole.MODEL,
			timestamp: 123,
			text: "final response",
		});

		const a2aService = new A2AService({
			handleQuery: async function* () {
				yield {
					event: "message_start" as const,
					data: {
						messageId: finalMessage.messageId,
						role: MessageRole.MODEL,
					},
				};
				yield {
					event: "part_delta" as const,
					data: {
						messageId: finalMessage.messageId,
						partIndex: 0,
						part: { kind: "text" as const },
						delta: "final response",
					},
				};
				yield {
					event: "message_complete" as const,
					data: { message: finalMessage },
				};
				return finalMessage;
			},
		} as any);

		const publish = jest.fn();
		await a2aService.execute(
			{
				userMessage: {
					contextId: "thread-1",
					metadata: {
						agentId: "agent-1",
						type: ThreadType.CHAT,
					},
					parts: [{ kind: "text", text: "hello" }],
				},
			} as any,
			{ publish } as any,
		);

		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish.mock.calls[1][0]).toMatchObject({
			kind: "status-update",
			contextId: "thread-1",
			status: {
				state: "completed",
				message: {
					parts: [{ kind: "text", text: "final response" }],
				},
			},
			final: true,
		});
	});
});
