import type { Request, Response } from "express";
import { createAuthzMiddleware } from "@/middlewares/authz.middleware";
import type { PermissionResolver, RouteRequirement } from "@/types/authz";

function mockRes(): Response & { _json?: unknown; _status?: number } {
	const res: any = { locals: {} };
	res.status = (c: number) => {
		res._status = c;
		return res;
	};
	res.json = (b: unknown) => {
		res._json = b;
		return res;
	};
	return res;
}

function mockReq(method: string, baseUrl: string, path: string, body?: unknown): Request {
	return { method, baseUrl, path, body: body ?? {}, params: {}, query: {} } as unknown as Request;
}

const routes: RouteRequirement[] = [
	{ method: "GET", path: "/api/document", resource: "logbook", action: "read", mode: "list" },
	{
		method: "POST",
		path: "/api/document",
		resource: "logbook",
		action: "write",
		mode: "fromBody",
		bodyAttrs: (req) => ({ venue: (req.body as any)?.labels?.workplace }),
	},
	{
		method: "POST",
		path: "/api/document/update/:id",
		resource: "logbook",
		action: "write",
		mode: "byId",
		loadAttrs: async (req) => ((req.params as any).id === "missing" ? null : { venue: "seoul" }),
	},
	{ method: "GET", path: "/api/admin/roles", resource: "authz", action: "write", mode: "gate" },
];

function makeResolver(over: Partial<PermissionResolver>): PermissionResolver {
	return {
		can: async () => false,
		listFilter: async () => null,
		...over,
	};
}

describe("createAuthzMiddleware", () => {
	it("passes through when no route matches", async () => {
		const mw = createAuthzMiddleware(makeResolver({}), routes);
		const next = jest.fn();
		await mw(mockReq("GET", "/api", "/model"), mockRes(), next);
		expect(next).toHaveBeenCalledWith();
	});

	it("list: sets res.locals.authzFilter from listFilter", async () => {
		const filter = { labels: { category: "logbook", workplace: ["walkerhill"] } };
		const mw = createAuthzMiddleware(makeResolver({ listFilter: async () => filter }), routes);
		const res = mockRes();
		const next = jest.fn();
		await mw(mockReq("GET", "/api", "/document"), res, next);
		expect(res.locals.authzFilter).toEqual(filter);
		expect(res.locals.authzChecked).toBe(true);
		expect(next).toHaveBeenCalledWith();
	});

	it("list: responds [] on deny", async () => {
		const mw = createAuthzMiddleware(makeResolver({ listFilter: async () => "deny" }), routes);
		const res = mockRes();
		const next = jest.fn();
		await mw(mockReq("GET", "/api", "/document"), res, next);
		expect(res._json).toEqual([]);
		expect(next).not.toHaveBeenCalled();
	});

	it("fromBody: 403 when can() is false", async () => {
		const mw = createAuthzMiddleware(makeResolver({ can: async () => false }), routes);
		const res = mockRes();
		const next = jest.fn();
		await mw(mockReq("POST", "/api", "/document", { labels: { workplace: "seoul" } }), res, next);
		expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
	});

	it("fromBody: passes when can() is true and forwards venue attr", async () => {
		const can = jest.fn(async () => true);
		const mw = createAuthzMiddleware(makeResolver({ can }), routes);
		const res = mockRes();
		const next = jest.fn();
		await mw(mockReq("POST", "/api", "/document", { labels: { workplace: "walkerhill" } }), res, next);
		expect(can).toHaveBeenCalledWith("", "logbook", "write", { venue: "walkerhill" });
		expect(res.locals.authzChecked).toBe(true);
		expect(next).toHaveBeenCalledWith();
	});

	it("byId: 404 when loadAttrs returns null", async () => {
		const mw = createAuthzMiddleware(makeResolver({ can: async () => true }), routes);
		const res = mockRes();
		const next = jest.fn();
		const req = mockReq("POST", "/api", "/document/update/missing");
		(req.params as any).id = "missing";
		await mw(req, res, next);
		expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
	});

	it("gate: 403 when can() false, pass when true", async () => {
		const deny = createAuthzMiddleware(makeResolver({ can: async () => false }), routes);
		const res1 = mockRes();
		const next1 = jest.fn();
		await deny(mockReq("GET", "/api/admin", "/roles"), res1, next1);
		expect(next1).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));

		const allow = createAuthzMiddleware(makeResolver({ can: async () => true }), routes);
		const res2 = mockRes();
		const next2 = jest.fn();
		await allow(mockReq("GET", "/api/admin", "/roles"), res2, next2);
		expect(next2).toHaveBeenCalledWith();
	});
});
