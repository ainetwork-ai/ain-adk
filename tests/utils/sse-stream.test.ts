import type { StreamEvent } from "@/types/stream";
import {
	completeCanonicalMessages,
	streamEventsToSSE,
} from "@/utils/sse-stream";

async function collect(events: StreamEvent[]): Promise<StreamEvent[]> {
	async function* source() {
		yield* events;
	}
	const out: StreamEvent[] = [];
	for await (const event of completeCanonicalMessages(source())) {
		out.push(event);
	}
	return out;
}

const chunk = (delta: string): StreamEvent => ({
	event: "text_chunk",
	data: { delta },
});

describe("completeCanonicalMessages", () => {
	// Single-inference advice emits only text_chunk.
	it("wraps a bare text_chunk stream in one complete canonical message", async () => {
		const out = await collect([chunk("a"), chunk("b")]);

		expect(out.map((e) => e.event)).toEqual([
			"message_start",
			"part_delta",
			"text_chunk",
			"part_delta",
			"text_chunk",
			"message_complete",
		]);
		const ids = new Set(
			out.flatMap((e) =>
				e.event === "message_complete"
					? [e.data.message.messageId]
					: e.event === "message_start" || e.event === "part_delta"
						? [e.data.messageId]
						: [],
			),
		);
		expect(ids.size).toBe(1);
		const complete = out.at(-1) as Extract<
			StreamEvent,
			{ event: "message_complete" }
		>;
		expect(complete.data.message.parts).toEqual([{ kind: "text", text: "ab" }]);
	});

	// Slot fill / template run / workflow advice start a message but never
	// complete it.
	it("completes an inner message that was started but never completed", async () => {
		const out = await collect([
			{ event: "message_start", data: { messageId: "m1", role: "MODEL" as never } },
			{
				event: "part_delta",
				data: { messageId: "m1", partIndex: 0, part: { kind: "text" }, delta: "x" },
			},
			chunk("x"),
			{
				event: "artifact_ready",
				data: { kind: "artifact", artifactId: "a1", name: "c.png" },
			},
		]);

		expect(out.map((e) => e.event)).toEqual([
			"message_start",
			"part_delta",
			"text_chunk",
			"artifact_ready",
			"message_complete",
		]);
		const complete = out.at(-1) as Extract<
			StreamEvent,
			{ event: "message_complete" }
		>;
		expect(complete.data.message).toMatchObject({
			messageId: "m1",
			parts: [
				{ kind: "text", text: "x" },
				{ kind: "artifact", artifactId: "a1", name: "c.png" },
			],
		});
	});

	it("passes an already complete stream through unchanged", async () => {
		const events: StreamEvent[] = [
			{ event: "message_start", data: { messageId: "m1", role: "MODEL" as never } },
			{
				event: "part_delta",
				data: { messageId: "m1", partIndex: 0, part: { kind: "text" }, delta: "x" },
			},
			chunk("x"),
			{
				event: "message_complete",
				data: {
					message: {
						messageId: "m1",
						role: "MODEL" as never,
						timestamp: 1,
						schemaVersion: 2,
						parts: [{ kind: "text", text: "x" }],
					},
				},
			},
		];
		expect(await collect(events)).toEqual(events);
	});

	it("leaves streams without text untouched", async () => {
		const events: StreamEvent[] = [
			{ event: "thread_id", data: { threadId: "t" } as never },
		];
		expect(await collect(events)).toEqual(events);
	});
});

describe("streamEventsToSSE", () => {
	// Every SSE endpoint (slot fill, template run, both advice paths) goes
	// through here, so a bare text_chunk producer still ends in message_complete.
	it("writes a complete canonical lifecycle for a text_chunk-only producer", async () => {
		const written: string[] = [];
		const res = {
			writeHead: jest.fn(),
			flushHeaders: jest.fn(),
			write: (chunk: string) => written.push(chunk),
			end: jest.fn(),
		};
		const req = { on: jest.fn() };

		await streamEventsToSSE(req as never, res as never, {
			logLabel: "test",
			userId: "u1",
			setup: async () =>
				(async function* () {
					yield chunk("advice");
				})(),
		});

		const events = written
			.filter((w) => w.startsWith("event: "))
			.map((w) => w.split("\n")[0].slice("event: ".length));
		expect(events).toEqual([
			"message_start",
			"part_delta",
			"text_chunk",
			"message_complete",
		]);
	});
});
