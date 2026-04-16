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
		const finalMessage = {
			messageId: "msg-1",
			role: "MODEL" as const,
			timestamp: 123,
			schemaVersion: 2 as const,
			parts: [{ kind: "text" as const, text: "ok" }],
		};

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
			return finalMessage;
		});

		const queryController = new QueryController({
			handleQuery,
		} as any, {
			resolveQueryInputArtifacts: jest.fn(async (_userId, input) => input),
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
				query:
					'Summarize this report\napplication/json: {"quarter":"Q1","revenue":1200}',
				displayQuery: undefined,
			},
		);
		expect(status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalledWith({
			content: "ok",
			message: finalMessage,
			threadId: "thread-1",
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("passes validation errors to next", async () => {
		const queryController = new QueryController({
			handleQuery: jest.fn(),
		} as any, {
			resolveQueryInputArtifacts: jest.fn(),
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

	it("resolves artifact references before calling QueryService", async () => {
		jest.mocked(getArtifactModule).mockReturnValue({} as any);

		const finalMessage = {
			messageId: "msg-1",
			role: "MODEL" as const,
			timestamp: 123,
			schemaVersion: 2 as const,
			parts: [{ kind: "text" as const, text: "ok" }],
		};

		const handleQuery = jest.fn(async function* () {
			return finalMessage;
		});
		const resolveQueryInputArtifacts = jest.fn(async (_userId, _input) => ({
			parts: [
				{ kind: "text" as const, text: "Review this file" },
				{
					kind: "artifact" as const,
					artifactId: "art-1",
					name: "report.pdf",
					mimeType: "application/pdf",
					size: 1024,
					downloadUrl: "/api/artifacts/art-1/download",
					previewText: "Quarterly report preview",
				},
			],
		}));

		const queryController = new QueryController(
			{
				handleQuery,
			} as any,
			{
				resolveQueryInputArtifacts,
			} as any,
		);

		const req = {
			body: {
				type: "CHAT",
				input: {
					parts: [
						{ kind: "text", text: "Review this file" },
						{ kind: "artifact", artifactId: "art-1" },
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

		expect(resolveQueryInputArtifacts).toHaveBeenCalledWith("user-1", {
			parts: [
				{ kind: "text", text: "Review this file" },
				{ kind: "artifact", artifactId: "art-1" },
			],
		});
		expect(handleQuery).toHaveBeenCalledWith(
			{
				type: "CHAT",
				userId: "user-1",
				threadId: undefined,
				workflowId: undefined,
				title: undefined,
			},
			{
				input: {
					parts: [
						{ kind: "text", text: "Review this file" },
						{
							kind: "artifact",
							artifactId: "art-1",
							name: "report.pdf",
							mimeType: "application/pdf",
							size: 1024,
							downloadUrl: "/api/artifacts/art-1/download",
							previewText: "Quarterly report preview",
						},
					],
				},
				query: "Review this file\nQuarterly report preview",
				displayQuery: undefined,
			},
		);
		expect(next).not.toHaveBeenCalled();
	});

	it("passes artifact validation errors to next for stream requests", async () => {
		jest.mocked(getArtifactModule).mockReturnValue({} as any);

		const queryController = new QueryController(
			{
				handleQuery: jest.fn(),
			} as any,
			{
				resolveQueryInputArtifacts: jest.fn(async () => {
					throw Object.assign(new Error("Artifact is not ready"), {
						code: "ARTIFACT_NOT_READY",
					});
				}),
			} as any,
		);

		const writeHead = jest.fn();
		const flushHeaders = jest.fn();
		const write = jest.fn();
		const end = jest.fn();
		const req = {
			body: {
				type: "CHAT",
				input: {
					parts: [{ kind: "artifact", artifactId: "art-1" }],
				},
			},
			on: jest.fn(),
		} as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			writeHead,
			flushHeaders,
			write,
			end,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await queryController.handleQueryStreamRequest(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		const error = (next as jest.Mock).mock.calls[0][0];
		expect(error.message).toBe("Artifact is not ready");
		expect(error.code).toBe("ARTIFACT_NOT_READY");
		expect(writeHead).not.toHaveBeenCalled();
		expect(flushHeaders).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(end).not.toHaveBeenCalled();
	});
});
