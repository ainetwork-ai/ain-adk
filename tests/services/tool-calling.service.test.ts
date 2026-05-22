import { setManifest } from "@/config/manifest";
import type { MCPModule, ModelModule } from "@/modules";
import type { BaseModel } from "@/modules/models/base.model";
import {
	MAX_TOOL_ITERATIONS,
	ToolCallingService,
} from "@/services/tool-calling.service";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector";
import { ThreadType, type ThreadObject } from "@/types/memory";
import type {
	AssembledToolCall,
	LLMStream,
	StreamChunk,
	StreamEvent,
} from "@/types/stream";

type AnyModel = BaseModel<unknown, unknown>;

function streamOf(chunks: StreamChunk[]): LLMStream {
	return {
		[Symbol.asyncIterator]() {
			let i = 0;
			return {
				async next(): Promise<IteratorResult<StreamChunk>> {
					if (i >= chunks.length) return { done: true, value: undefined };
					return { done: false, value: chunks[i++] };
				},
			};
		},
	};
}

function textChunk(content: string): StreamChunk {
	return { delta: { content } };
}

function toolCallChunk(
	index: number,
	id: string,
	name: string,
	argsJson: string,
): StreamChunk {
	return {
		delta: {
			tool_calls: [
				{
					index,
					id,
					type: "function",
					function: { name, arguments: argsJson },
				},
			],
		},
	};
}

function makeModel(streams: LLMStream[]): jest.Mocked<AnyModel> {
	let call = 0;
	const model = {
		generateMessages: jest.fn(() => []),
		convertToolsToFunctions: jest.fn(() => []),
		fetchStreamWithContextMessage: jest.fn(async () => {
			const s = streams[call];
			call += 1;
			if (!s) {
				throw new Error(
					`fetchStreamWithContextMessage called more times (${call}) than streams provided (${streams.length})`,
				);
			}
			return s;
		}),
		appendAssistantToolCallTurn: jest.fn(),
		appendToolResult: jest.fn(),
		fetch: jest.fn(),
		fetchWithContextMessage: jest.fn(),
	} as unknown as jest.Mocked<AnyModel>;
	return model;
}

function makeModelModule(model: AnyModel): ModelModule {
	return {
		getModel: () => model,
		getModelOptions: () => ({}),
	} as unknown as ModelModule;
}

function makeThread(): ThreadObject {
	return {
		userId: "user-1",
		threadId: "thread-1",
		type: ThreadType.CHAT,
		title: "Test",
		messages: [],
	};
}

function mcpTool(name: string): ConnectorTool {
	return {
		toolName: name,
		connectorName: "mcp-connector",
		protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
		description: name,
		inputSchema: { type: "object" },
	};
}

async function drain<TYield, TReturn>(
	gen: AsyncGenerator<TYield, TReturn, unknown>,
): Promise<{ events: TYield[]; result: TReturn }> {
	const events: TYield[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return { events, result: next.value };
}

beforeAll(() => {
	setManifest({
		name: "TestAgent",
		description: "test",
	});
});

describe("ToolCallingService", () => {
	it("returns without pushing assistant turn when no tool calls are emitted", async () => {
		const model = makeModel([streamOf([textChunk("hello "), textChunk("world")])]);
		const svc = new ToolCallingService(makeModelModule(model));
		const messages: unknown[] = [];

		const { events, result } = await drain(
			svc.run({
				messages,
				tools: [],
				query: "hi",
				thread: makeThread(),
			}),
		);

		expect(result.toolCallsExecuted).toBe(0);
		expect(events).toEqual([
			{ event: "text_chunk", data: { delta: "hello " } },
			{ event: "text_chunk", data: { delta: "world" } },
		]);
		expect(model.appendAssistantToolCallTurn).not.toHaveBeenCalled();
		expect(model.appendToolResult).not.toHaveBeenCalled();
	});

	it("pushes a single assistant tool-call turn and a matching tool result", async () => {
		const model = makeModel([
			streamOf([toolCallChunk(0, "call_1", "search", '{"q":"foo"}')]),
			streamOf([textChunk("final answer")]),
		]);
		const mcp = {
			useTool: jest.fn(async () => "mcp result"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);
		const messages: unknown[] = [];

		const { result } = await drain(
			svc.run({
				messages,
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(result.toolCallsExecuted).toBe(1);
		expect(model.appendAssistantToolCallTurn).toHaveBeenCalledTimes(1);
		expect(model.appendAssistantToolCallTurn).toHaveBeenCalledWith(messages, {
			content: null,
			toolCalls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "search", arguments: '{"q":"foo"}' },
				},
			] satisfies AssembledToolCall[],
		});
		expect(model.appendToolResult).toHaveBeenCalledTimes(1);
		expect(model.appendToolResult).toHaveBeenCalledWith(messages, {
			toolCallId: "call_1",
			toolName: "search",
			content: "mcp result",
		});
		expect(mcp.useTool).toHaveBeenCalledTimes(1);
	});

	it("preserves streamed text alongside tool calls in the assistant turn", async () => {
		const model = makeModel([
			streamOf([
				textChunk("Let me check. "),
				toolCallChunk(0, "call_a", "search", '{"q":"x"}'),
			]),
			streamOf([textChunk("done")]),
		]);
		const mcp = {
			useTool: jest.fn(async () => "ok"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(model.appendAssistantToolCallTurn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ content: "Let me check. " }),
		);
	});

	it("pushes one tool result per tool call in the same round, matched by id", async () => {
		const model = makeModel([
			streamOf([
				toolCallChunk(0, "id_a", "search", '{"q":"a"}'),
				toolCallChunk(1, "id_b", "lookup", '{"k":"b"}'),
			]),
			streamOf([textChunk("aggregated")]),
		]);
		const mcp = {
			useTool: jest.fn(async (tool: ConnectorTool) => `result:${tool.toolName}`),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		const { result } = await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search"), mcpTool("lookup")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(result.toolCallsExecuted).toBe(2);
		expect(model.appendAssistantToolCallTurn).toHaveBeenCalledTimes(1);
		expect(model.appendToolResult).toHaveBeenCalledTimes(2);
		expect(model.appendToolResult).toHaveBeenNthCalledWith(1, expect.anything(), {
			toolCallId: "id_a",
			toolName: "search",
			content: "result:search",
		});
		expect(model.appendToolResult).toHaveBeenNthCalledWith(2, expect.anything(), {
			toolCallId: "id_b",
			toolName: "lookup",
			content: "result:lookup",
		});
	});

	it("pushes an isError tool result and skips dispatch when arguments are invalid JSON", async () => {
		const model = makeModel([
			streamOf([toolCallChunk(0, "call_bad", "search", "{not json")]),
			streamOf([textChunk("fallback")]),
		]);
		const mcp = {
			useTool: jest.fn(),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(mcp.useTool).not.toHaveBeenCalled();
		expect(model.appendToolResult).toHaveBeenCalledWith(expect.anything(), {
			toolCallId: "call_bad",
			toolName: "search",
			content: expect.stringContaining("Invalid tool arguments JSON"),
			isError: true,
		});
	});

	it("pushes an isError tool result when the model calls an unknown tool", async () => {
		const model = makeModel([
			streamOf([toolCallChunk(0, "call_x", "doesNotExist", "{}")]),
			streamOf([textChunk("done")]),
		]);
		const mcp = {
			useTool: jest.fn(),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(mcp.useTool).not.toHaveBeenCalled();
		expect(model.appendToolResult).toHaveBeenCalledWith(expect.anything(), {
			toolCallId: "call_x",
			toolName: "doesNotExist",
			content: expect.stringContaining("not available"),
			isError: true,
		});
	});

	it("stops the loop at MAX_TOOL_ITERATIONS when the model keeps issuing tool calls", async () => {
		const looping: LLMStream[] = Array.from(
			{ length: MAX_TOOL_ITERATIONS + 5 },
			(_, i) =>
				streamOf([toolCallChunk(0, `call_${i}`, "search", '{"q":"x"}')]),
		);
		const model = makeModel(looping);
		const mcp = {
			useTool: jest.fn(async () => "x"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		const { result } = await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(model.fetchStreamWithContextMessage).toHaveBeenCalledTimes(
			MAX_TOOL_ITERATIONS,
		);
		expect(model.appendAssistantToolCallTurn).toHaveBeenCalledTimes(
			MAX_TOOL_ITERATIONS,
		);
		expect(result.toolCallsExecuted).toBe(MAX_TOOL_ITERATIONS);
	});

	it("downgrades toolChoice from 'required' to 'auto' after the first round", async () => {
		const model = makeModel([
			streamOf([toolCallChunk(0, "call_1", "search", "{}")]),
			streamOf([textChunk("done")]),
		]);
		// "required" only takes effect when functions.length > 0
		(model.convertToolsToFunctions as jest.Mock).mockReturnValue([
			{ name: "search" },
		]);
		const mcp = {
			useTool: jest.fn(async () => "ok"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
				toolChoice: "required",
			}),
		);

		const calls = (model.fetchStreamWithContextMessage as jest.Mock).mock.calls;
		expect(calls[0][2]).toMatchObject({ toolChoice: "required" });
		expect(calls[1][2]).toMatchObject({ toolChoice: "auto" });
	});

	it("invokes appendAssistantToolCallTurn before any appendToolResult call", async () => {
		const order: string[] = [];
		const model = makeModel([
			streamOf([toolCallChunk(0, "id_a", "search", "{}")]),
			streamOf([textChunk("done")]),
		]);
		(model.appendAssistantToolCallTurn as jest.Mock).mockImplementation(() => {
			order.push("assistant");
		});
		(model.appendToolResult as jest.Mock).mockImplementation(() => {
			order.push("tool");
		});
		const mcp = {
			useTool: jest.fn(async () => "ok"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		expect(order).toEqual(["assistant", "tool"]);
	});

	it("yields a thinking_process event before each successful tool dispatch", async () => {
		const model = makeModel([
			streamOf([toolCallChunk(0, "id_a", "search", "{}")]),
			streamOf([textChunk("done")]),
		]);
		const mcp = {
			useTool: jest.fn(async () => "ok"),
		} as unknown as MCPModule;
		const svc = new ToolCallingService(makeModelModule(model), undefined, mcp);

		const { events } = await drain(
			svc.run({
				messages: [],
				tools: [mcpTool("search")],
				query: "q",
				thread: makeThread(),
			}),
		);

		const thinking = events.filter(
			(e): e is Extract<StreamEvent, { event: "thinking_process" }> =>
				e.event === "thinking_process",
		);
		expect(thinking).toHaveLength(1);
		expect(thinking[0].data.title).toContain("search");
	});
});
