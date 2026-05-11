import type { Request, Response } from "express";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "./logger";

export type SSEStreamOptions = {
	logLabel: string;
	userId: string;
	logContext?: Record<string, unknown>;
	onThreadId?: (threadId: string) => void;
	onThinkingProcess?: (
		threadId: string,
		data: Extract<StreamEvent, { event: "thinking_process" }>["data"],
	) => Promise<void> | void;
	setup: (signal: AbortSignal) => Promise<AsyncIterable<StreamEvent>>;
};

export async function streamEventsToSSE(
	req: Request,
	res: Response,
	options: SSEStreamOptions,
): Promise<void> {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no", // nginx 버퍼링 비활성화
	});
	res.flushHeaders();
	res.write(":ok\n\n");

	const keepaliveInterval = setInterval(() => {
		res.write(":keepalive\n\n");
	}, 10000); // 10초마다 keepalive 전송

	const abortController = new AbortController();
	let currentThreadId: string | undefined;
	req.on("close", () => {
		abortController.abort();
		loggers.intentStream.info(`${options.logLabel} client connection closed`, {
			threadId: currentThreadId,
			userId: options.userId,
			...options.logContext,
		});
	});

	try {
		const stream = await options.setup(abortController.signal);
		for await (const event of stream) {
			if (abortController.signal.aborted) break;

			if (event.event === "thread_id") {
				currentThreadId = event.data.threadId;
				options.onThreadId?.(event.data.threadId);
			} else if (
				event.event === "thinking_process" &&
				currentThreadId &&
				options.onThinkingProcess
			) {
				await options.onThinkingProcess(currentThreadId, event.data);
			}

			res.write(
				`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
			);
		}
	} catch (error: unknown) {
		const errMsg =
			(error as Error)?.message || `Failed to handle ${options.logLabel}`;
		res.write(`event: error\ndata: ${JSON.stringify({ message: errMsg })}\n\n`);
	} finally {
		clearInterval(keepaliveInterval);
		res.end();
	}
}
