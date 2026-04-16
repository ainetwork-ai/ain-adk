import type { NextFunction, Request, Response } from "express";
import { ArtifactApiController } from "@/controllers/api/artifact.api.controller";

describe("ArtifactApiController", () => {
	it("uploads artifacts from JSON/base64 input", async () => {
		const controller = new ArtifactApiController({
			uploadArtifact: jest.fn(async (_userId, input) => ({
				artifactId: "art-1",
				userId: "user-1",
				status: "uploaded" as const,
				name: input.name,
				mimeType: input.mimeType,
				size: input.data.length,
				storageKey: "artifacts/report.pdf",
				threadId: input.threadId,
				messageId: input.messageId,
				metadata: input.metadata,
				createdAt: 100,
			})),
			getArtifact: jest.fn(),
			openDownload: jest.fn(),
		} as any);

		const json = jest.fn();
		const status = jest.fn().mockReturnValue({ json });
		const req = {
			body: {
				name: "report.pdf",
				mimeType: "application/pdf",
				data: Buffer.from("hello").toString("base64"),
				threadId: "thread-1",
				messageId: "msg-1",
				metadata: { source: "upload" },
			},
		} as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			status,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleUploadArtifact(req, res, next);

		expect(status).toHaveBeenCalledWith(201);
		expect(json).toHaveBeenCalledWith({
			artifactId: "art-1",
			userId: "user-1",
			status: "uploaded",
			name: "report.pdf",
			mimeType: "application/pdf",
			size: 5,
			storageKey: "artifacts/report.pdf",
			threadId: "thread-1",
			messageId: "msg-1",
			metadata: { source: "upload" },
			createdAt: 100,
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("passes upload validation errors to next", async () => {
		const controller = new ArtifactApiController({
			uploadArtifact: jest.fn(),
			getArtifact: jest.fn(),
			openDownload: jest.fn(),
		} as any);

		const req = {
			body: {
				name: "report.pdf",
				mimeType: "application/pdf",
				data: "not base64!!!",
			},
		} as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleUploadArtifact(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		const error = (next as jest.Mock).mock.calls[0][0];
		expect(error.message).toBe(
			"Artifact upload 'data' must be a valid base64 string.",
		);
		expect(error.code).toBe("INVALID_ARTIFACT_UPLOAD");
	});

	it("returns artifact metadata as JSON", async () => {
		const controller = new ArtifactApiController({
			uploadArtifact: jest.fn(),
			getArtifact: jest.fn(async () => ({
				artifactId: "art-1",
				name: "report.pdf",
			})),
			openDownload: jest.fn(),
		} as any);

		const json = jest.fn();
		const req = { params: { id: "art-1" } } as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			json,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleGetArtifact(req, res, next);

		expect(json).toHaveBeenCalledWith({
			artifactId: "art-1",
			name: "report.pdf",
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("streams artifact downloads with headers", async () => {
		const controller = new ArtifactApiController({
			uploadArtifact: jest.fn(),
			getArtifact: jest.fn(),
			openDownload: jest.fn(async () => ({
				body: new Uint8Array([1, 2, 3]),
				mimeType: "application/pdf",
				fileName: "report.pdf",
				contentLength: 3,
			})),
		} as any);

		const setHeader = jest.fn();
		const attachment = jest.fn();
		const send = jest.fn();
		const req = { params: { id: "art-1" } } as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			setHeader,
			attachment,
			send,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleDownloadArtifact(req, res, next);

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
		expect(setHeader).toHaveBeenCalledWith("Content-Length", "3");
		expect(attachment).toHaveBeenCalledWith("report.pdf");
		expect(send).toHaveBeenCalledWith(Buffer.from(new Uint8Array([1, 2, 3])));
		expect(next).not.toHaveBeenCalled();
	});
});
