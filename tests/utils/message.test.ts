import { MessageRole, type MessageObject, ThreadType } from "@/types/memory";
import {
	createModelInputMessage,
	createModelInputMessageFromQueryInput,
	createMessageFromQueryInput,
	createTextMessage,
	createThoughtPart,
	createToolCallPart,
	createToolMessage,
	createToolResultPart,
	normalizeMessageObject,
	serializeMessageForIntent,
	serializeThreadForIntent,
} from "@/utils/message";

describe("message utilities", () => {
	it("normalizes legacy messages into canonical multipart messages", () => {
		const legacyMessage: MessageObject = {
			messageId: "msg-1",
			role: MessageRole.USER,
			timestamp: 100,
			content: {
				type: "text",
				parts: ["hello", "world"],
			},
		};

		expect(normalizeMessageObject(legacyMessage)).toEqual({
			messageId: "msg-1",
			role: MessageRole.USER,
			timestamp: 100,
			schemaVersion: 2,
			metadata: undefined,
			parts: [
				{ kind: "text", text: "hello" },
				{ kind: "text", text: "world" },
			],
		});
	});

	it("creates canonical user messages from structured query input", () => {
		const message = createMessageFromQueryInput({
			messageId: "msg-2",
			role: MessageRole.USER,
			timestamp: 200,
			displayText: "Summarize the attached report",
			input: {
				parts: [
					{
						kind: "artifact",
						artifactId: "art-1",
						name: "report.pdf",
						previewText: "Revenue increased by 20 percent.",
					},
				],
			},
		});

		expect(message).toEqual({
			messageId: "msg-2",
			role: MessageRole.USER,
			timestamp: 200,
			schemaVersion: 2,
			metadata: undefined,
			parts: [
				{ kind: "text", text: "Summarize the attached report" },
				{
					kind: "artifact",
					artifactId: "art-1",
					name: "report.pdf",
					mimeType: undefined,
					size: undefined,
					downloadUrl: undefined,
					previewText: "Revenue increased by 20 percent.",
				},
			],
		});
	});

	it("creates canonical model input messages for provider bridge calls", () => {
		expect(
			createModelInputMessage({
				messageId: "model-input-1",
				timestamp: 123,
				text: "hello model",
			}),
		).toEqual({
			messageId: "model-input-1",
			role: MessageRole.USER,
			timestamp: 123,
			schemaVersion: 2,
			metadata: undefined,
			parts: [{ kind: "text", text: "hello model" }],
		});

		expect(
			createModelInputMessageFromQueryInput({
				messageId: "model-input-2",
				timestamp: 456,
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
			}),
		).toMatchObject({
			messageId: "model-input-2",
			role: MessageRole.USER,
			timestamp: 456,
			schemaVersion: 2,
			parts: [
				{ kind: "text", text: "Summarize this" },
				{
					kind: "artifact",
					artifactId: "art-1",
					previewText: "file preview",
				},
			],
		});
	});

	it("serializes mixed thread history for intent prompts", () => {
		const thread = {
			userId: "user-1",
			threadId: "thread-1",
			type: ThreadType.CHAT,
			title: "Thread",
			messages: [
				createTextMessage({
					messageId: "msg-3",
					role: MessageRole.USER,
					timestamp: 1,
					text: "Analyze this file",
				}),
				{
					messageId: "msg-4",
					role: MessageRole.MODEL,
					timestamp: 2,
					schemaVersion: 2 as const,
					parts: [
						{
							kind: "artifact" as const,
							artifactId: "art-2",
							name: "summary.csv",
							mimeType: "text/csv",
							previewText: "month,revenue\nJan,100",
						},
					],
				},
			],
		};

		expect(serializeThreadForIntent(thread)).toBe(
			'User: """Analyze this file"""\nAssistant: """month,revenue\nJan,100"""',
		);
	});

	it("serializes thought and data parts consistently", () => {
		const message: MessageObject = {
			messageId: "msg-5",
			role: MessageRole.TOOL,
			timestamp: 300,
			schemaVersion: 2,
			parts: [
				{
					kind: "thought",
					title: "Collecting data",
					description: "Fetching the latest metrics.",
				},
				{
					kind: "data",
					mimeType: "application/json",
					data: { total: 3 },
				},
			],
		};

		expect(serializeMessageForIntent(message)).toBe(
			'Collecting data\nFetching the latest metrics.\napplication/json: {"total":3}',
		);
	});

	it("creates canonical tool and thought parts", () => {
		const toolCallPart = createToolCallPart({
			toolCallId: "call-1",
			toolName: "search",
			args: { query: "hello" },
		});
		const toolResultPart = createToolResultPart({
			toolCallId: "call-1",
			toolName: "search",
			result: "found it",
		});
		const thoughtPart = createThoughtPart({
			title: "Running search",
			description: "Checking available sources.",
		});

		expect(toolCallPart).toEqual({
			kind: "tool-call",
			toolCallId: "call-1",
			toolName: "search",
			args: { query: "hello" },
		});
		expect(toolResultPart).toEqual({
			kind: "tool-result",
			toolCallId: "call-1",
			toolName: "search",
			result: "found it",
		});
		expect(thoughtPart).toEqual({
			kind: "thought",
			title: "Running search",
			description: "Checking available sources.",
		});
	});

	it("creates canonical tool messages for model append bridges", () => {
		const toolCallPart = createToolCallPart({
			toolCallId: "call-1",
			toolName: "search",
			args: { query: "hello" },
		});
		const toolResultPart = createToolResultPart({
			toolCallId: "call-1",
			toolName: "search",
			result: "found it",
		});
		const thoughtPart = createThoughtPart({
			title: "Running search",
			description: "Checking available sources.",
		});

		expect(
			createToolMessage({
				messageId: "tool-msg-1",
				timestamp: 123,
				thoughtPart,
				toolCallPart,
				toolResultPart,
			}),
		).toEqual({
			messageId: "tool-msg-1",
			role: MessageRole.TOOL,
			timestamp: 123,
			metadata: undefined,
			schemaVersion: 2,
			parts: [thoughtPart, toolCallPart, toolResultPart],
		});
	});
});
