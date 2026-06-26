import type { Request, Response } from "express";
import { DocumentApiController } from "@/controllers/api/document.api.controller";
import type { MemoryModule } from "@/modules";

function makeController(listDocuments: jest.Mock, getDocument: jest.Mock) {
	const memoryModule = {
		getDocumentMemory: () => ({ listDocuments, getDocument }),
	} as unknown as MemoryModule;
	return new DocumentApiController(memoryModule, {} as any, {} as any);
}

function res(locals: Record<string, unknown>): Response {
	return { locals, json: jest.fn() } as unknown as Response;
}

describe("DocumentApiController authz", () => {
	it("list: uses authzFilter — calls listDocuments twice and merges/dedupes results", async () => {
		const ownDoc = { documentId: "own-1", userId: "u1" };
		const logbookDoc = { documentId: "lb-1", userId: "other" };
		const sharedDoc = { documentId: "shared", userId: "u1" };
		// First call (own): returns ownDoc + sharedDoc; second call (logbooks): returns logbookDoc + sharedDoc
		const listDocuments = jest
			.fn()
			.mockResolvedValueOnce([ownDoc, sharedDoc])
			.mockResolvedValueOnce([logbookDoc, sharedDoc]);
		const c = makeController(listDocuments, jest.fn());
		const authzFilter = { labels: { category: "logbook", workplace: ["walkerhill", "seoul"] } };
		const r = res({ userId: "u1", authzFilter });
		await c.handleGetAllDocuments({ query: {} } as Request, r, jest.fn());
		// First call: own docs
		expect(listDocuments).toHaveBeenNthCalledWith(1, "u1", expect.objectContaining({}));
		// Second call: logbook filter with undefined userId
		expect(listDocuments).toHaveBeenNthCalledWith(
			2,
			undefined,
			expect.objectContaining({ labels: expect.objectContaining({ category: "logbook" }) }),
		);
		expect(listDocuments).toHaveBeenCalledTimes(2);
		// Result deduped: own-1, lb-1, shared (3 unique docs)
		const returned = (r.json as jest.Mock).mock.calls[0][0] as { documentId: string }[];
		const ids = returned.map((d) => d.documentId).sort();
		expect(ids).toEqual(["lb-1", "own-1", "shared"]);
	});

	it("list: authzListAll → listDocuments called once with (undefined, baseFilter)", async () => {
		const allDoc = { documentId: "all-1", userId: "admin" };
		const listDocuments = jest.fn(async () => [allDoc]);
		const c = makeController(listDocuments, jest.fn());
		const r = res({ userId: "admin", authzListAll: true });
		await c.handleGetAllDocuments({ query: {} } as Request, r, jest.fn());
		expect(listDocuments).toHaveBeenCalledTimes(1);
		expect(listDocuments).toHaveBeenCalledWith(undefined, expect.any(Object));
		expect((r.json as jest.Mock).mock.calls[0][0]).toEqual([allDoc]);
	});

	it("list: keeps userId scoping when no authzFilter (backward compat)", async () => {
		const listDocuments = jest.fn(async () => []);
		const c = makeController(listDocuments, jest.fn());
		await c.handleGetAllDocuments({ query: {} } as Request, res({ userId: "u1" }), jest.fn());
		expect(listDocuments).toHaveBeenCalledWith("u1", expect.any(Object));
	});

	it("byId: skips ownership check when authzChecked", async () => {
		const getDocument = jest.fn(async () => ({ documentId: "d1", userId: "other" }));
		const c = makeController(jest.fn(), getDocument);
		const r = res({ userId: "u1", authzChecked: true });
		await c.handleGetDocument({ params: { id: "d1" } } as unknown as Request, r, jest.fn());
		expect(r.json).toHaveBeenCalledWith({ documentId: "d1", userId: "other" });
	});

	it("byId: enforces ownership when not authzChecked (backward compat)", async () => {
		const getDocument = jest.fn(async () => ({ documentId: "d1", userId: "other" }));
		const c = makeController(jest.fn(), getDocument);
		const next = jest.fn();
		await c.handleGetDocument(
			{ params: { id: "d1" } } as unknown as Request,
			res({ userId: "u1" }),
			next,
		);
		expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
	});
});
