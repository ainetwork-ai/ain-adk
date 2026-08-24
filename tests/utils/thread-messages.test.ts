import { MessageRole, type ThreadObject, ThreadType } from "@/types/memory";
import {
	appendRichMessageToThread,
	appendTextMessageToThread,
	persistTextMessage,
} from "@/utils/thread-messages";

function makeThread(): ThreadObject {
	return {
		userId: "user-1",
		threadId: "thread-1",
		type: ThreadType.CHAT,
		title: "Thread",
		messages: [],
	};
}

function makeMemory() {
	const addMessagesToThread = jest.fn(async () => {});
	return {
		memoryModule: {
			getThreadMemory: () => ({ addMessagesToThread }),
		} as any,
		addMessagesToThread,
	};
}

describe("thread message write helpers", () => {
	it("writes text messages in canonical schemaVersion 2 form", async () => {
		const { memoryModule, addMessagesToThread } = makeMemory();

		const message = await appendTextMessageToThread(
			memoryModule,
			makeThread(),
			MessageRole.MODEL,
			"hello",
			{ workflowRun: true },
			"msg-1",
		);

		expect(message).toMatchObject({
			messageId: "msg-1",
			schemaVersion: 2,
			role: MessageRole.MODEL,
			parts: [{ kind: "text", text: "hello" }],
			metadata: { workflowRun: true },
		});
		expect(addMessagesToThread).toHaveBeenCalledWith("user-1", "thread-1", [
			message,
		]);
	});

	it("writes rich messages as canonical text/document parts", async () => {
		const { memoryModule } = makeMemory();

		const message = await appendRichMessageToThread(
			memoryModule,
			makeThread(),
			MessageRole.MODEL,
			[
				{ type: "text", text: "intro" },
				{ type: "document", documentId: "doc-1", title: "Report" },
			],
		);

		expect(message).toMatchObject({
			schemaVersion: 2,
			parts: [
				{ kind: "text", text: "intro" },
				{ kind: "document", documentId: "doc-1", title: "Report" },
			],
		});
	});

	it("persists standalone text messages in canonical form", async () => {
		const { memoryModule, addMessagesToThread } = makeMemory();

		await persistTextMessage(
			memoryModule,
			"user-1",
			"thread-1",
			MessageRole.USER,
			"hi",
		);

		expect(addMessagesToThread).toHaveBeenCalledWith("user-1", "thread-1", [
			expect.objectContaining({
				schemaVersion: 2,
				parts: [{ kind: "text", text: "hi" }],
			}),
		]);
	});
});
