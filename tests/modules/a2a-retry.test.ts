import { A2AModule } from "@/modules/a2a/a2a.module";
import type { ConnectorTool } from "@/types/connector";
import { CONNECTOR_PROTOCOL_TYPE } from "@/types/connector";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";

const THREAD_ID = "thread-1";

const thinkingEvent: StreamEvent = {
	event: "thinking_process",
	data: { title: "working", description: "" },
} as StreamEvent;

// Dies before producing anything — the remote may never have seen the
// request, so retrying is safe.
async function* failingBeforeYield(): AsyncGenerator<
	StreamEvent,
	string,
	unknown
> {
	throw new Error("boom: stream idle timeout");
}

// Dies after events were already delivered — the remote is executing and
// the consumer already saw output, so a retry would duplicate both.
async function* failingAfterYield(): AsyncGenerator<
	StreamEvent,
	string,
	unknown
> {
	yield thinkingEvent;
	throw new Error("boom: connection reset mid-stream");
}

async function* successStream(): AsyncGenerator<StreamEvent, string, unknown> {
	yield thinkingEvent;
	return "[Bot Called A2A Tool analysis-agent]\nanalysis result";
}

const drain = async (gen: AsyncGenerator<StreamEvent, string, unknown>) => {
	const events: StreamEvent[] = [];
	let r = await gen.next();
	while (!r.done) {
		events.push(r.value);
		r = await gen.next();
	}
	return { events, result: r.value };
};

const buildModule = () => {
	const module = new A2AModule();
	// biome-ignore lint/suspicious/noExplicitAny: reach into private state for the test
	(module as any).a2aConnectors.set("analysis-agent", {
		name: "analysis-agent",
		url: "http://fake",
	});
	return module;
};

describe("A2AModule retry behaviour", () => {
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		errorSpy = jest.spyOn(loggers.a2a, "error").mockReturnValue(loggers.a2a);
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it("sendTask retries when the first attempt died before yielding anything", async () => {
		const module = buildModule();
		const sendSpy = jest
			// biome-ignore lint/suspicious/noExplicitAny: private method
			.spyOn(module as any, "sendMessageToConnector")
			.mockImplementationOnce(failingBeforeYield)
			.mockImplementationOnce(successStream);

		const { events, result } = await drain(
			module.sendTask({
				connectorName: "analysis-agent",
				message: "analyze",
				threadId: THREAD_ID,
			}),
		);

		expect(result).toBe("[Bot Called A2A Tool analysis-agent]\nanalysis result");
		expect(sendSpy).toHaveBeenCalledTimes(2);
		// Consumers see the successful attempt's events exactly once.
		expect(events).toEqual([thinkingEvent]);
	});

	it("sendTask does NOT retry once events were already delivered", async () => {
		const module = buildModule();
		const sendSpy = jest
			// biome-ignore lint/suspicious/noExplicitAny: private method
			.spyOn(module as any, "sendMessageToConnector")
			.mockImplementation(failingAfterYield);

		await expect(
			drain(
				module.sendTask({
					connectorName: "analysis-agent",
					message: "analyze",
					threadId: THREAD_ID,
				}),
			),
		).rejects.toThrow("boom: connection reset mid-stream");
		// A retry here would re-execute the remote task and replay the
		// already-delivered events to the consumer.
		expect(sendSpy).toHaveBeenCalledTimes(1);
	});

	it("sendTask propagates the error when the retry also fails", async () => {
		const module = buildModule();
		const sendSpy = jest
			// biome-ignore lint/suspicious/noExplicitAny: private method
			.spyOn(module as any, "sendMessageToConnector")
			.mockImplementation(failingBeforeYield);

		await expect(
			drain(
				module.sendTask({
					connectorName: "analysis-agent",
					message: "analyze",
					threadId: THREAD_ID,
				}),
			),
		).rejects.toThrow("boom: stream idle timeout");
		expect(sendSpy).toHaveBeenCalledTimes(2);
	});

	it("logs the actual error message instead of an empty object", async () => {
		const module = buildModule();
		// biome-ignore lint/suspicious/noExplicitAny: private method
		jest.spyOn(module as any, "sendMessageToConnector")
			.mockImplementation(failingBeforeYield);

		await drain(
			module.sendTask({
				connectorName: "analysis-agent",
				message: "analyze",
				threadId: THREAD_ID,
			}),
		).catch(() => {});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				error: expect.stringContaining("boom: stream idle timeout"),
			}),
		);
	});

	it("drops the stale A2A task mapping before retrying", async () => {
		const module = buildModule();
		// biome-ignore lint/suspicious/noExplicitAny: private state
		(module as any).a2aTasks.set(THREAD_ID, "broken-task");
		// biome-ignore lint/suspicious/noExplicitAny: private method
		jest.spyOn(module as any, "sendMessageToConnector")
			.mockImplementation(failingBeforeYield);

		await drain(
			module.sendTask({
				connectorName: "analysis-agent",
				message: "analyze",
				threadId: THREAD_ID,
			}),
		).catch(() => {});

		// biome-ignore lint/suspicious/noExplicitAny: private state
		expect((module as any).a2aTasks.has(THREAD_ID)).toBe(false);
	});

	it("useTool retries but returns a marked error string with the real message", async () => {
		const module = buildModule();
		const tool: ConnectorTool = {
			connectorName: "analysis-agent",
			toolName: "analysis-agent",
			protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
			description: "",
			// biome-ignore lint/suspicious/noExplicitAny: minimal tool stub
		} as any;
		const sendSpy = jest
			// biome-ignore lint/suspicious/noExplicitAny: private method
			.spyOn(module as any, "sendMessageToConnector")
			.mockImplementation(failingBeforeYield);

		const { result } = await drain(
			module.useTool(tool, "analyze", THREAD_ID),
		);

		expect(sendSpy).toHaveBeenCalledTimes(2);
		expect(result).toContain("[Bot Called A2A Tool analysis-agent]");
		expect(result).toContain("boom: stream idle timeout");
		expect(result).not.toContain("{}");
	});
});
