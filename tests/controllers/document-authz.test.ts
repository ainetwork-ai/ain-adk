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
	it("list: uses authzFilter and drops userId when authz governs", async () => {
		const listDocuments = jest.fn(async () => []);
		const c = makeController(listDocuments, jest.fn());
		const authzFilter = { labels: { category: "logbook", workplace: ["walkerhill", "seoul"] } };
		await c.handleGetAllDocuments(
			{ query: {} } as Request,
			res({ userId: "u1", authzFilter }),
			jest.fn(),
		);
		expect(listDocuments).toHaveBeenCalledWith(undefined, expect.objectContaining({
			labels: { category: "logbook", workplace: ["walkerhill", "seoul"] },
		}));
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
