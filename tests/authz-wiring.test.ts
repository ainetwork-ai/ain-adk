import express from "express";
import request from "supertest";
import { AINAgent } from "@/index";
import type { AuthzConfig } from "@/types/authz";
import type { AuthModule, MemoryModule, ModelModule } from "@/modules";

function fakeModules() {
	const authModule = {
		authenticate: async () => ({ isAuthenticated: true, userId: "u1" }),
	} as unknown as AuthModule;
	const modelModule = {} as unknown as ModelModule;
	const memoryModule = {
		getDocumentMemory: () => undefined,
		getUserWorkflowMemory: () => undefined,
		initialize: async () => undefined,
	} as unknown as MemoryModule;
	return { authModule, modelModule, memoryModule };
}

describe("AINAgent authz wiring", () => {
	it("mounts adminRouter under /api/admin guarded by the authorize middleware", async () => {
		const adminRouter = express.Router();
		adminRouter.get("/roles", (_req, res) => res.json([{ name: "admin" }]));

		let canCalls = 0;
		const authz: AuthzConfig = {
			resolver: {
				can: async () => {
					canCalls++;
					return true;
				},
				listFilter: async () => null,
			},
			routes: [
				{ method: "GET", path: "/api/admin/roles", resource: "authz", action: "write", mode: "gate" },
			],
			adminRouter,
		};

		const agent = new AINAgent(
			{ name: "t", description: "t" },
			{ ...fakeModules(), authz },
		);

		const r = await request(agent.app).get("/api/admin/roles");
		expect(r.status).toBe(200);
		expect(r.body).toEqual([{ name: "admin" }]);
		expect(canCalls).toBe(1);
	});

	it("denies admin route with 403 when can() is false", async () => {
		const adminRouter = express.Router();
		adminRouter.get("/roles", (_req, res) => res.json([]));
		const authz: AuthzConfig = {
			resolver: { can: async () => false, listFilter: async () => null },
			routes: [
				{ method: "GET", path: "/api/admin/roles", resource: "authz", action: "write", mode: "gate" },
			],
			adminRouter,
		};
		const agent = new AINAgent({ name: "t", description: "t" }, { ...fakeModules(), authz });
		const r = await request(agent.app).get("/api/admin/roles");
		expect(r.status).toBe(403);
	});
});
