import { ThreadService } from "@/services/thread.service";
import { MessageRole, ThreadType, type MessageObject } from "@/types/memory";

describe("ThreadService", () => {
	const legacyMessage: MessageObject = {
		messageId: "legacy-msg-1",
		role: MessageRole.USER,
		timestamp: 100,
		content: {
			type: "text",
			parts: ["legacy hello"],
		},
	};

	it("returns canonical message views when reading threads", async () => {
		const getThread = jest.fn(async () => ({
			userId: "user-1",
			threadId: "thread-1",
			type: ThreadType.CHAT,
			title: "Thread",
			messages: [legacyMessage],
		}));
		const service = new ThreadService({
			getThreadMemory: () => ({
				getThread,
			}),
		} as any);

		await expect(service.getThread("user-1", "thread-1")).resolves.toEqual({
			userId: "user-1",
			threadId: "thread-1",
			type: ThreadType.CHAT,
			title: "Thread",
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
		});
	});

	it("normalizes messages before writing to thread memory", async () => {
		const addMessagesToThread = jest.fn(async () => {});
		const service = new ThreadService({
			getThreadMemory: () => ({
				addMessagesToThread,
			}),
		} as any);

		await service.addMessagesToThread("user-1", "thread-1", [legacyMessage]);

		expect(addMessagesToThread).toHaveBeenCalledWith("user-1", "thread-1", [
			{
				messageId: "legacy-msg-1",
				role: MessageRole.USER,
				timestamp: 100,
				metadata: undefined,
				schemaVersion: 2,
				parts: [{ kind: "text", text: "legacy hello" }],
			},
		]);
	});
});
