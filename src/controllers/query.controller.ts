import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { QueryService, QueryStreamService } from "@/services";
import { AinHttpError } from "@/types/agent";
import { MessageRole } from "@/types/memory";

export class QueryController {
	private queryService;
	private queryStreamService;

	constructor(
		queryService: QueryService,
		queryStreamService?: QueryStreamService,
	) {
		this.queryService = queryService;
		this.queryStreamService = queryStreamService;
	}

	public handleQueryRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, message, threadId } = req.body;
		const userId = res.locals.userId;

		try {
			const result = await this.queryService.handleQuery(
				{ type, userId, threadId },
				message,
			);

			res.status(200).json(result);
		} catch (error) {
			next(error);
		}
	};

	public handleQueryStreamRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, threadId, message } = req.body;
		const userId = res.locals.userId;

		if (!this.queryStreamService) {
			const error = new AinHttpError(
				StatusCodes.NOT_IMPLEMENTED,
				"Stream query not supported",
			);
			return next(error);
		}

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
		const stream = this.queryStreamService.handleQueryStream(
			{ type, userId, threadId },
			message,
		);

		try {
			for await (const event of stream) {
				if (event.event === "thread_id") {
					currentThreadId = event.data.threadId;
				} else if (event.event === "thinking_process") {
					// a2a 호출에 대해서는 데이터베이스에 추가하지 않기 위해 여기서 thread message에 기록
					this.queryStreamService.addToThreadMessages(userId, currentThreadId, [
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
