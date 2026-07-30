import {
	injectRequestContext,
	logFileExtension,
	resolveLogFormat,
	textLogFormat,
} from "@/utils/logger";
import { runWithRequestContext } from "@/utils/request-context";

const MESSAGE = Symbol.for("message");

type TransformedInfo = Record<string | symbol, unknown>;

const transform = (
	format: { transform: (info: never) => unknown },
	info: Record<string, unknown>,
): TransformedInfo => {
	const result = format.transform({ ...info } as never);
	if (!result || typeof result === "boolean") {
		throw new Error("format dropped the log entry");
	}
	return result as TransformedInfo;
};

describe("injectRequestContext", () => {
	it("adds requestId, userId and threadId from the ambient context", () => {
		runWithRequestContext(
			{ requestId: "req-1", userId: "user-1", threadId: "thread-1" },
			() => {
				const info = transform(injectRequestContext(), {
					level: "info",
					message: "hello",
				});
				expect(info.requestId).toBe("req-1");
				expect(info.userId).toBe("user-1");
				expect(info.threadId).toBe("thread-1");
			},
		);
	});

	it("does not override values passed explicitly at the call site", () => {
		runWithRequestContext(
			{ requestId: "req-1", threadId: "ctx-thread" },
			() => {
				const info = transform(injectRequestContext(), {
					level: "info",
					message: "hello",
					threadId: "explicit-thread",
				});
				expect(info.threadId).toBe("explicit-thread");
			},
		);
	});

	it("leaves the entry unchanged outside of a context", () => {
		const info = transform(injectRequestContext(), {
			level: "info",
			message: "hello",
		});
		expect(info.requestId).toBeUndefined();
	});
});

describe("textLogFormat", () => {
	it("prefixes a short request id and keeps it out of the meta JSON", () => {
		const info = transform(textLogFormat, {
			level: "info",
			message: "hello",
			timestamp: "12:00:00",
			service: "Intent",
			requestId: "abcd1234-5678-90ef-ghij-klmnopqrstuv",
			threadId: "thread-1",
		});
		const line = info[MESSAGE] as string;
		expect(line).toBe(
			'12:00:00 [Intent] [req:abcd1234] info: hello | {"threadId":"thread-1"}',
		);
	});

	it("keeps the original shape when there is no request id", () => {
		const info = transform(textLogFormat, {
			level: "info",
			message: "hello",
			timestamp: "12:00:00",
			service: "Intent",
		});
		expect(info[MESSAGE]).toBe("12:00:00 [Intent] info: hello");
	});
});

describe("resolveLogFormat", () => {
	const originalFormat = process.env.LOG_FORMAT;

	afterEach(() => {
		if (originalFormat === undefined) delete process.env.LOG_FORMAT;
		else process.env.LOG_FORMAT = originalFormat;
	});

	it("defaults file output to json and console output to text", () => {
		delete process.env.LOG_FORMAT;
		expect(resolveLogFormat("file")).toBe("json");
		expect(resolveLogFormat("console")).toBe("text");
	});

	it("honours LOG_FORMAT as an override for both outputs", () => {
		process.env.LOG_FORMAT = "text";
		expect(resolveLogFormat("file")).toBe("text");
		process.env.LOG_FORMAT = "json";
		expect(resolveLogFormat("console")).toBe("json");
	});
});

describe("logFileExtension", () => {
	const originalFormat = process.env.LOG_FORMAT;

	afterEach(() => {
		if (originalFormat === undefined) delete process.env.LOG_FORMAT;
		else process.env.LOG_FORMAT = originalFormat;
	});

	it("appends .jsonl to rotated files when file output is json", () => {
		delete process.env.LOG_FORMAT;
		expect(logFileExtension("logs/debug-log")).toBe(".jsonl");
	});

	it("adds nothing in text mode, keeping legacy file names", () => {
		process.env.LOG_FORMAT = "text";
		expect(logFileExtension("logs/debug-log")).toBe("");
	});

	it("adds nothing when the path already carries a json extension", () => {
		delete process.env.LOG_FORMAT;
		expect(logFileExtension("logs/app.jsonl")).toBe("");
		expect(logFileExtension("logs/app.json")).toBe("");
	});
});
