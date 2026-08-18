import type { NextFunction, Request, Response } from "express";
import { DocumentApiController } from "@/controllers/api/document.api.controller";
import { AinHttpError } from "@/types/agent";
import {
	type Document,
	DocumentFormat,
	DocumentSource,
} from "@/types/document";

function makeDoc(overrides: Partial<Document> = {}): Document {
	return {
		documentId: "d1",
		userId: "u1",
		title: "t",
		format: DocumentFormat.MARKDOWN,
		content: "c",
		source: DocumentSource.MANUAL,
		version: 1,
		createdAt: "t",
		updatedAt: "t",
		...overrides,
	};
}

function mockRes(userId: string, authzChecked = false): Response {
	const res: any = { locals: { userId, authzChecked } };
	res.status = jest.fn().mockReturnValue(res);
	res.send = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	return res;
}

function setup(document: Document | undefined) {
	const documentMemory = {
		getDocument: jest.fn().mockResolvedValue(document),
		updateDocument: jest.fn().mockResolvedValue(undefined),
	};
	const memoryModule: any = {
		getDocumentMemory: () => documentMemory,
	};
	const schedulerService: any = { removeDocumentAutoRefresh: jest.fn() };
	const controller = new DocumentApiController(
		memoryModule,
		{} as any,
		{} as any,
		schedulerService,
	);
	return { controller, documentMemory, schedulerService };
}

describe("DocumentApiController.handleHideDocument", () => {
	const req = { params: { id: "d1" } } as unknown as Request;

	it("sets hidden=true via updateDocument and returns 200", async () => {
		const { controller, documentMemory, schedulerService } = setup(makeDoc());
		const res = mockRes("u1");
		const next: NextFunction = jest.fn();

		await controller.handleHideDocument(req, res, next);

		expect(documentMemory.updateDocument).toHaveBeenCalledWith("d1", {
			hidden: true,
		});
		expect(schedulerService.removeDocumentAutoRefresh).toHaveBeenCalledWith(
			"d1",
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(next).not.toHaveBeenCalled();
	});

	it("404s when the document does not exist (or is already hidden)", async () => {
		const { controller, documentMemory } = setup(undefined);
		const res = mockRes("u1");
		const next: NextFunction = jest.fn();

		await controller.handleHideDocument(req, res, next);

		const err = (next as jest.Mock).mock.calls[0][0] as AinHttpError;
		expect(err).toBeInstanceOf(AinHttpError);
		expect(err.status).toBe(404);
		expect(documentMemory.updateDocument).not.toHaveBeenCalled();
	});

	it("403s on another user's document without authz grant", async () => {
		const { controller, documentMemory } = setup(makeDoc({ userId: "other" }));
		const res = mockRes("u1", false);
		const next: NextFunction = jest.fn();

		await controller.handleHideDocument(req, res, next);

		const err = (next as jest.Mock).mock.calls[0][0] as AinHttpError;
		expect(err.status).toBe(403);
		expect(documentMemory.updateDocument).not.toHaveBeenCalled();
	});

	it("hides another user's document when authz middleware granted access", async () => {
		const { controller, documentMemory } = setup(makeDoc({ userId: "other" }));
		const res = mockRes("u1", true);
		const next: NextFunction = jest.fn();

		await controller.handleHideDocument(req, res, next);

		expect(documentMemory.updateDocument).toHaveBeenCalledWith("d1", {
			hidden: true,
		});
	});
});
