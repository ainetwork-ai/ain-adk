import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { QueryService } from "@/services";
import { MessageRole } from "@/types/memory";

export class QueryController {
	private queryService: QueryService;

	constructor(queryService: QueryService) {
		this.queryService = queryService;
	}

	public handleQueryRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const {
			type,
			threadId,
			message: query,
			displayMessage: displayQuery,
		} = req.body;
		const userId = res.locals.userId;

		try {
			const stream = this.queryService.handleQuery(
				{ type, userId, threadId },
				{ query, displayQuery },
			);

			let content = "";
			let responseThreadId = threadId;

			for await (const event of stream) {
				if (event.event === "thread_id") {
					responseThreadId = event.data.threadId;
				} else if (event.event === "text_chunk" && event.data.delta) {
					content += event.data.delta;
				}
			}

			res.status(200).json({ content, threadId: responseThreadId });
		} catch (error) {
			next(error);
		}
	};

	public handleQueryStreamRequest = async (
		req: Request,
		res: Response,
		_next: NextFunction,
	) => {
		const {
			type,
			threadId,
			message: query,
			displayMessage: displayQuery,
		} = req.body;
		const userId = res.locals.userId;

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

		let currentThreadId = threadId;
		const stream = this.queryService.handleQuery(
			{ type, userId, threadId },
			{ query, displayQuery },
		);

		try {
			for await (const event of stream) {
				if (event.event === "thread_id") {
					currentThreadId = event.data.threadId;
				} else if (event.event === "thinking_process") {
					// a2a 호출에 대해서는 데이터베이스에 추가하지 않기 위해 여기서 thread message에 기록
					this.queryService.addToThreadMessages(userId, currentThreadId, [
						{
							messageId: randomUUID(),
							role: MessageRole.MODEL,
							timestamp: Date.now(),
							content: { type: "text", parts: [event.data.title] },
							metadata: {
								isThinking: true,
								thinkData: event.data,
							},
						},
					]);
				}

				res.write(
					`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
				);
			}
		} catch (error: unknown) {
			const errMsg =
				(error as Error)?.message || "Failed to handle query stream";
			res.write(`event: error\ndata: ${errMsg}\n\n`);
		} finally {
			clearInterval(keepaliveInterval);
			res.end();
		}
	};
}
