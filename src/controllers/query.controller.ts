import type { NextFunction, Request, Response } from "express";
import type { QueryService } from "@/services";
import { MessageRole } from "@/types/memory";
import { streamEventsToSSE } from "@/utils/sse-stream";

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
			workflowId,
			title,
			message: query,
			displayMessage: displayQuery,
			documentIds,
		} = req.body;
		const userId = res.locals.userId;

		try {
			const stream = this.queryService.handleQuery(
				{ type, userId, threadId, workflowId, title },
				{ query, displayQuery, documentIds },
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
			workflowId,
			title,
			message: query,
			displayMessage: displayQuery,
			documentIds,
		} = req.body;
		const userId = res.locals.userId;

		await streamEventsToSSE(req, res, {
			logLabel: "query stream",
			userId,
			setup: async () =>
				this.queryService.handleQuery(
					{ type, userId, threadId, workflowId, title },
					{ query, displayQuery, documentIds },
				),
			onThinkingProcess: async (currentThreadId, data) => {
				// a2a 호출에 대해서는 데이터베이스에 추가하지 않기 위해 여기서 thread message에 기록
				const thinkData =
					await this.queryService.filterThinkingDataForStorage(data);
				await this.queryService.addTextMessage(
					userId,
					currentThreadId,
					MessageRole.MODEL,
					thinkData.title,
					{
						isThinking: true,
						thinkData,
					},
				);
			},
		});
	};
}
