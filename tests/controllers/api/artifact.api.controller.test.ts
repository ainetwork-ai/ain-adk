import type { NextFunction, Request, Response } from "express";
import { ArtifactApiController } from "@/controllers/api/artifact.api.controller";

describe("ArtifactApiController", () => {
	it("returns artifact metadata as JSON", async () => {
		const controller = new ArtifactApiController({
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
