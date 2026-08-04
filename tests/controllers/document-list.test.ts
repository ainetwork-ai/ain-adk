import type { NextFunction, Request, Response } from "express";
import { DocumentApiController } from "@/controllers/api/document.api.controller";
import type { MemoryModule } from "@/modules/index";
import type { Document } from "@/types/document";
import { DocumentSource } from "@/types/document";

function doc(id: string, over: Partial<Document> = {}): Document {
	return {
		documentId: id,
		userId: "u1",
		title: id,
		content: "",
		source: DocumentSource.MANUAL,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		slots: [{ slotId: "s1" }],
		...over,
	} as Document;
}

function makeController(docMemory: object) {
	const memoryModule = {
		getDocumentMemory: () => docMemory,
	} as unknown as MemoryModule;
	return new DocumentApiController(
		memoryModule,
		{} as never,
		{} as never,
		{} as never,
	);
}

function mockRes(): Response & { _json?: unknown } {
	const res: any = { locals: { userId: "u1" } };
	res.json = (b: unknown) => {
		res._json = b;
		return res;
	};
	res.status = () => res;
	return res;
}

function mockReq(query: Record<string, unknown> = {}): Request {
	return { query, params: {} } as unknown as Request;
}

const next: NextFunction = (err?: unknown) => {
	if (err) throw err;
};

describe("handleGetAllDocuments", () => {
	it("no limit + legacy provider → bare array", async () => {
		const controller = makeController({
			listDocuments: async () => [doc("a"), doc("b")],
		});
		const res = mockRes();
		await controller.handleGetAllDocuments(mockReq(), res, next);
		expect(Array.isArray(res._json)).toBe(true);
		expect((res._json as Document[]).map((d) => d.documentId)).toEqual([
			"a",
			"b",
		]);
	});

	it("limit + capable provider → envelope with provider results", async () => {
		const listDocumentsAny = jest.fn(async () => [doc("a")]);
		const countDocumentsAny = jest.fn(async () => 42);
		const controller = makeController({ listDocumentsAny, countDocumentsAny });
		const res = mockRes();
		await controller.handleGetAllDocuments(
			mockReq({ limit: "15", offset: "30", view: "summary" }),
			res,
			next,
		);
		expect(res._json).toEqual({
			items: [doc("a")],
			total: 42,
			limit: 15,
			offset: 30,
		});
		expect(listDocumentsAny).toHaveBeenCalledWith(
			[{ userId: "u1", filter: expect.any(Object) }],
			{ limit: 15, offset: 30, summary: true },
		);
	});

	it("builds one filter set per authz scope with merged labels", async () => {
		const listDocumentsAny = jest.fn(async () => []);
		const controller = makeController({
			listDocumentsAny,
			countDocumentsAny: async () => 0,
		});
		const res = mockRes();
		res.locals.authzFilters = [{ labels: { workplace: "seoul" } }];
		await controller.handleGetAllDocuments(
			mockReq({ labels: { category: "logbook" } }),
			res,
			next,
		);
		const sets = listDocumentsAny.mock.calls[0][0];
		expect(sets).toHaveLength(2);
		expect(sets[0].userId).toBe("u1");
		expect(sets[1].userId).toBeUndefined();
		expect(sets[1].filter.labels).toEqual({
			category: "logbook",
			workplace: "seoul",
		});
	});

	it("legacy provider + limit → in-memory sort desc, slice, honest total", async () => {
		const docs = [
			doc("old", { updatedAt: "2026-08-01T00:00:00.000Z" }),
			doc("new", { updatedAt: "2026-08-03T00:00:00.000Z" }),
			doc("mid", { updatedAt: "2026-08-02T00:00:00.000Z" }),
		];
		const controller = makeController({ listDocuments: async () => docs });
		const res = mockRes();
		await controller.handleGetAllDocuments(
			mockReq({ limit: "2", offset: "0" }),
			res,
			next,
		);
		const body = res._json as { items: Document[]; total: number };
		expect(body.total).toBe(3);
		expect(body.items.map((d) => d.documentId)).toEqual(["new", "mid"]);
	});

	it("legacy provider + view=summary → slots stripped", async () => {
		const controller = makeController({
			listDocuments: async () => [doc("a")],
		});
		const res = mockRes();
		await controller.handleGetAllDocuments(
			mockReq({ view: "summary" }),
			res,
			next,
		);
		expect((res._json as Document[])[0]).not.toHaveProperty("slots");
	});

	it("legacy provider + date range → filtered in memory", async () => {
		const controller = makeController({
			listDocuments: async () => [
				doc("jul", { labels: { date: "2026-07-31" } }),
				doc("aug", { labels: { date: "2026-08-01" } }),
				doc("nodate"),
			],
		});
		const res = mockRes();
		await controller.handleGetAllDocuments(
			mockReq({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }),
			res,
			next,
		);
		expect((res._json as Document[]).map((d) => d.documentId)).toEqual([
			"aug",
		]);
	});

	it("authz union in legacy path dedupes by documentId", async () => {
		const controller = makeController({
			listDocuments: async () => [doc("dup")],
		});
		const res = mockRes();
		res.locals.authzFilters = [{ labels: { workplace: "seoul" } }];
		await controller.handleGetAllDocuments(mockReq(), res, next);
		expect(res._json as Document[]).toHaveLength(1);
	});
});
