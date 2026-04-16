import { setManifest } from "@/config/manifest";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import { CONNECTOR_PROTOCOL_TYPE } from "@/types/connector";
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
		const generateMessages = jest.fn(() => []);
		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages,
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
		expect(generateMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "hello there",
				input: expect.objectContaining({
					role: MessageRole.USER,
					schemaVersion: 2,
					parts: [{ kind: "text", text: "hello there" }],
				}),
			}),
		);
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

	it("uses provided canonical model input for single-intent fulfillment", async () => {
		const generateMessages = jest.fn(() => []);
		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages,
					convertToolsToFunctions: () => [],
					appendMessages: jest.fn(),
					fetchStreamWithContextMessage: async () => ({
						async *[Symbol.asyncIterator]() {
							yield {
								delta: {
									content: "structured reply",
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
					addMessagesToThread: jest.fn(async () => {}),
				}),
			} as any,
		);

		const modelInput = {
			messageId: "input-1",
			role: MessageRole.USER,
			timestamp: 100,
			schemaVersion: 2 as const,
			parts: [
				{ kind: "text" as const, text: "Summarize this" },
				{
					kind: "artifact" as const,
					artifactId: "art-1",
					previewText: "file preview",
				},
			],
		};

		const stream = service.intentFulfill(
			[{ subquery: "Summarize this\nfile preview" }],
			{
				userId: "user-1",
				threadId: "thread-1",
				type: ThreadType.CHAT,
				title: "Thread",
				messages: [],
			},
			"Summarize this\nfile preview",
			false,
			modelInput,
		);

		while (true) {
			const result = await stream.next();
			if (result.done) {
				break;
			}
		}

		expect(generateMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "Summarize this\nfile preview",
				input: modelInput,
			}),
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

	it("emits canonical tool events for MCP tool execution while preserving provider append fallback", async () => {
		let streamCallCount = 0;
		const appendMessages = jest.fn();
		const useTool = jest.fn(async () => "tool result text");

		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages: () => [],
					convertToolsToFunctions: () => [],
					appendMessages,
					fetchStreamWithContextMessage: async () => {
						const isToolRequest = streamCallCount === 0;
						streamCallCount += 1;

						return {
							async *[Symbol.asyncIterator]() {
								if (isToolRequest) {
									yield {
										delta: {
											tool_calls: [
												{
													index: 0,
													id: "tool-call-1",
													function: {
														name: "search",
														arguments:
															'{"query":"hello","thinking_text":"checking sources"}',
													},
												},
											],
										},
									};
									return;
								}

								yield {
									delta: {
										content: "final answer",
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
					addMessagesToThread: jest.fn(async () => {}),
				}),
			} as any,
			undefined,
			{
				getTools: () => [
					{
						toolName: "search",
						connectorName: "test-mcp",
						protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
					},
				],
				useTool,
			} as any,
		);

		const stream = service.intentFulfill(
			[{ subquery: "find info" }],
			{
				userId: "user-1",
				threadId: "thread-1",
				type: ThreadType.CHAT,
				title: "Thread",
				messages: [],
			},
			"find info",
			false,
		);

		const events = [];
		let finalMessage;
		while (true) {
			const result = await stream.next();
			if (result.done) {
				finalMessage = result.value;
				break;
			}
			events.push(result.value);
		}

		expect(events.map((event) => event.event)).toEqual([
			"thinking_process",
			"thinking_process",
			"tool_start",
			"tool_output",
			"message_start",
			"part_delta",
			"text_chunk",
			"message_complete",
		]);
		expect(events[1]).toMatchObject({
			event: "thinking_process",
			data: {
				title: "[Test Agent] MCP 실행: search",
				description: "checking sources",
			},
		});
		expect(events[2]).toEqual({
			event: "tool_start",
			data: {
				toolCallId: "tool-call-1",
				protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
				toolName: "search",
				toolArgs: {
					query: "hello",
					thinking_text: "checking sources",
				},
			},
		});
		expect(events[3]).toEqual({
			event: "tool_output",
			data: {
				toolCallId: "tool-call-1",
				protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
				toolName: "search",
				result: "tool result text",
			},
		});
		expect(useTool).toHaveBeenCalledWith(
			expect.objectContaining({ toolName: "search" }),
			{ query: "hello", thinking_text: "checking sources" },
		);
		expect(appendMessages).toHaveBeenCalledWith(
			[],
			"tool result text",
			expect.objectContaining({
				role: MessageRole.TOOL,
				schemaVersion: 2,
				parts: [
					{
						kind: "thought",
						title: "[Test Agent] MCP 실행: search",
						description: "checking sources",
					},
					{
						kind: "tool-call",
						toolCallId: "tool-call-1",
						toolName: "search",
						args: {
							query: "hello",
							thinking_text: "checking sources",
						},
					},
					{
						kind: "tool-result",
						toolCallId: "tool-call-1",
						toolName: "search",
						result: "tool result text",
					},
				],
			}),
		);
		expect(finalMessage).toMatchObject({
			role: MessageRole.MODEL,
			schemaVersion: 2,
			parts: [{ kind: "text", text: "final answer" }],
		});
	});

	it("emits canonical tool events for A2A tool execution", async () => {
		let streamCallCount = 0;
		const appendMessages = jest.fn();

		const service = new IntentFulfillService(
			{
				getModel: () => ({
					generateMessages: () => [],
					convertToolsToFunctions: () => [],
					appendMessages,
					fetchStreamWithContextMessage: async () => {
						const isToolRequest = streamCallCount === 0;
						streamCallCount += 1;

						return {
							async *[Symbol.asyncIterator]() {
								if (isToolRequest) {
									yield {
										delta: {
											tool_calls: [
												{
													index: 0,
													id: "a2a-call-1",
													function: {
														name: "remote_agent",
														arguments:
															'{"thinking_text":"asking remote agent"}',
													},
												},
											],
										},
									};
									return;
								}

								yield {
									delta: {
										content: "answer after remote result",
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
					addMessagesToThread: jest.fn(async () => {}),
				}),
			} as any,
			{
				getTools: async () => [
					{
						toolName: "remote_agent",
						connectorName: "remote",
						protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
					},
				],
				useTool: () =>
					(async function* () {
						yield {
							event: "thinking_process" as const,
							data: {
								title: "Remote agent",
								description: "working",
							},
						};
						return "remote result text";
					})(),
			} as any,
		);

		const stream = service.intentFulfill(
			[{ subquery: "ask remote" }],
			{
				userId: "user-1",
				threadId: "thread-1",
				type: ThreadType.CHAT,
				title: "Thread",
				messages: [],
			},
			"ask remote",
			false,
		);

		const events = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(events).toEqual(
			expect.arrayContaining([
				{
					event: "tool_start",
					data: {
						toolCallId: "a2a-call-1",
						protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
						toolName: "remote_agent",
						toolArgs: {
							thinking_text: "asking remote agent",
						},
					},
				},
				{
					event: "tool_output",
					data: {
						toolCallId: "a2a-call-1",
						protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
						toolName: "remote_agent",
						result: "remote result text",
					},
				},
				{
					event: "thinking_process",
					data: {
						title: "Remote agent",
						description: "working",
					},
				},
			]),
		);
		expect(events.at(-1)).toMatchObject({
			event: "message_complete",
			data: {
				message: {
					role: MessageRole.MODEL,
					schemaVersion: 2,
					parts: [{ kind: "text", text: "answer after remote result" }],
				},
			},
		});
		expect(appendMessages).toHaveBeenCalledWith(
			[],
			"remote result text",
			expect.objectContaining({
				role: MessageRole.TOOL,
				schemaVersion: 2,
				parts: [
					{
						kind: "thought",
						title: "[Test Agent] A2A 실행: remote_agent",
						description: "asking remote agent",
					},
					{
						kind: "tool-call",
						toolCallId: "a2a-call-1",
						toolName: "remote_agent",
						args: {
							thinking_text: "asking remote agent",
						},
					},
					{
						kind: "tool-result",
						toolCallId: "a2a-call-1",
						toolName: "remote_agent",
						result: "remote result text",
					},
				],
			}),
		);
	});
});
