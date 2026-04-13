import type { NextFunction, Request, Response } from "express";
import { getArtifactModule } from "@/config/modules";
import { QueryController } from "@/controllers/query.controller";

jest.mock("@/config/modules", () => ({
	getArtifactModule: jest.fn(),
}));

describe("QueryController", () => {
	beforeEach(() => {
		jest.mocked(getArtifactModule).mockReturnValue(undefined);
	});

	it("normalizes structured query input before calling QueryService", async () => {
		const handleQuery = jest.fn(async function* () {
			yield {
				event: "thread_id" as const,
				data: {
					type: "CHAT" as const,
					userId: "user-1",
					threadId: "thread-1",
					title: "Thread",
				},
			};
			yield {
				event: "text_chunk" as const,
				data: { delta: "ok" },
			};
		});

		const queryController = new QueryController({
			handleQuery,
		} as any);

		const req = {
			body: {
				type: "CHAT",
				input: {
					parts: [
						{ kind: "text", text: "Summarize this report" },
						{
							kind: "data",
							mimeType: "application/json",
							data: { quarter: "Q1", revenue: 1200 },
						},
					],
				},
			},
		} as Request;

		const json = jest.fn();
		const status = jest.fn().mockReturnValue({ json });
		const res = {
			locals: { userId: "user-1" },
			status,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await queryController.handleQueryRequest(req, res, next);

		expect(handleQuery).toHaveBeenCalledWith(
			{
				type: "CHAT",
				userId: "user-1",
				threadId: undefined,
				workflowId: undefined,
				title: undefined,
			},
			{
				query:
					'Summarize this report\napplication/json: {"quarter":"Q1","revenue":1200}',
				displayQuery: undefined,
			},
		);
		expect(status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalledWith({
			content: "ok",
			threadId: "thread-1",
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("passes validation errors to next", async () => {
		const queryController = new QueryController({
			handleQuery: jest.fn(),
		} as any);

		const req = {
			body: {
				input: {
					parts: [{ kind: "artifact", artifactId: "art_123" }],
				},
			},
		} as Request;
		const res = {
			locals: { userId: "user-1" },
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await queryController.handleQueryRequest(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		const error = (next as jest.Mock).mock.calls[0][0];
		expect(error.message).toBe(
			"Artifact input requires an artifact module to be configured.",
		);
		expect(error.code).toBe("ARTIFACT_STORE_NOT_CONFIGURED");
	});
});
