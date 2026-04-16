import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getArtifactModule } from "@/config/modules";
import type { QueryService } from "@/services";
import type { ArtifactService } from "@/services/artifact.service";
import { type CanonicalMessageObject, MessageRole } from "@/types/memory";
import type { QueryMessageInput } from "@/types/message-input";
import { loggers } from "@/utils/logger";
import {
	createModelInputMessageFromQueryInput,
	createTextMessage,
	extractTextContent,
	serializeMessageForModelFallback,
} from "@/utils/message";
import { normalizeQueryRequest } from "@/utils/query-input";

export class QueryController {
	private queryService: QueryService;
	private artifactService?: ArtifactService;

	constructor(queryService: QueryService, artifactService?: ArtifactService) {
		this.queryService = queryService;
		this.artifactService = artifactService;
	}

	private async normalizeAndResolveInput(
		body: unknown,
		userId: string,
	): Promise<{
		input: QueryMessageInput;
		query: string;
		displayQuery?: string;
	}> {
		const normalized = normalizeQueryRequest(body, {
			artifactModuleConfigured: !!getArtifactModule(),
		});

		const input = this.artifactService
			? await this.artifactService.resolveQueryInputArtifacts(
					userId,
					normalized.input,
				)
			: normalized.input;

		return {
			input,
			query: serializeMessageForModelFallback(
				createModelInputMessageFromQueryInput({ input }),
			),
			displayQuery: normalized.displayQuery,
		};
	}

	public handleQueryRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, threadId, workflowId, title } = req.body;
		const userId = res.locals.userId;

		try {
			const { input, query, displayQuery } =
				await this.normalizeAndResolveInput(req.body, userId);
			const stream = this.queryService.handleQuery(
				{ type, userId, threadId, workflowId, title },
				{ input, query, displayQuery },
			);

			let responseThreadId = threadId;
			let message: CanonicalMessageObject | undefined;

			while (true) {
				const result = await stream.next();
				if (result.done) {
					message = result.value;
					break;
				}

				const event = result.value;
				if (event.event === "thread_id") {
					responseThreadId = event.data.threadId;
				}
			}

			res.status(200).json({
				content: message ? extractTextContent(message) : "",
				message,
				threadId: responseThreadId,
			});
		} catch (error) {
			next(error);
		}
	};

	public handleQueryStreamRequest = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		const { type, threadId, workflowId, title } = req.body;
		const userId = res.locals.userId;
		let input: QueryMessageInput;
		let query: string;
		let displayQuery: string | undefined;

		try {
			({ input, query, displayQuery } = await this.normalizeAndResolveInput(
				req.body,
				userId,
			));
		} catch (error) {
			next(error);
			return;
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

		// 클라이언트 연결 끊김 감지
		let aborted = false;
		req.on("close", () => {
			aborted = true;
			loggers.intentStream.info("Client connection closed", {
				threadId: currentThreadId,
				userId,
			});
		});

		let currentThreadId = threadId;
		const stream = this.queryService.handleQuery(
			{ type, userId, threadId, workflowId, title },
			{ input, query, displayQuery },
		);

		try {
			for await (const event of stream) {
				if (aborted) {
					break;
				}

				if (event.event === "thread_id") {
					currentThreadId = event.data.threadId;
				} else if (event.event === "thinking_process") {
					// a2a 호출에 대해서는 데이터베이스에 추가하지 않기 위해 여기서 thread message에 기록
					this.queryService.addToThreadMessages(userId, currentThreadId, [
						createTextMessage({
							messageId: randomUUID(),
							role: MessageRole.MODEL,
							timestamp: Date.now(),
							text: event.data.title,
							metadata: {
								isThinking: true,
								thinkData: event.data,
							},
						}),
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
