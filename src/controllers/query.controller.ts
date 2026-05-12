import type { NextFunction, Request, Response } from "express";
import { getArtifactModule } from "@/config/modules";
import type { QueryService } from "@/services";
import type { ArtifactService } from "@/services/artifact.service";
import { type CanonicalMessageObject, MessageRole } from "@/types/memory";
import type { QueryMessageInput } from "@/types/message-input";
import {
	createModelInputMessageFromQueryInput,
	extractTextContent,
	serializeMessageForModelFallback,
} from "@/utils/message";
import { normalizeQueryRequest } from "@/utils/query-input";
import { streamEventsToSSE } from "@/utils/sse-stream";

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

		await streamEventsToSSE(req, res, {
			logLabel: "query stream",
			userId,
			setup: async () =>
				this.queryService.handleQuery(
					{ type, userId, threadId, workflowId, title },
					{ input, query, displayQuery },
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
