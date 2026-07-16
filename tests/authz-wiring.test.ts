import request from "supertest";
import { AINAgent } from "@/index";
import type { AuthModule, MemoryModule, ModelModule } from "@/modules";
import type { AuthzConfig } from "@/types/authz";

function fakeModules() {
	const authModule = {
		authenticate: async () => ({ isAuthenticated: true, userId: "u1" }),
	} as unknown as AuthModule;
	const modelModule = {} as unknown as ModelModule;
	const memoryModule = {
		getDocumentMemory: () => undefined,
		getUserWorkflowMemory: () => undefined,
		getScheduleRunMemory: () => undefined,
		initialize: async () => undefined,
	} as unknown as MemoryModule;
	return { authModule, modelModule, memoryModule };
}

// A gate-mode requirement on an /api path lets us observe the authorize
// middleware running inside the /api chain without needing a real handler.
const gateRoute = {
	method: "GET",
	path: "/api/agent",
	resource: "authz",
	action: "read" as const,
	mode: "gate" as const,
};

describe("AINAgent authz wiring", () => {
	it("runs the authorize middleware on /api routes and denies with 403", async () => {
		let canCalls = 0;
		const authz: AuthzConfig = {
			resolver: {
				can: async () => {
					canCalls++;
					return false;
				},
				listFilter: async () => null,
			},
			routes: [gateRoute],
		};
		const agent = new AINAgent({ name: "t", description: "t" }, { ...fakeModules(), authz });
		const r = await request(agent.app).get("/api/agent");
		expect(canCalls).toBe(1);
		expect(r.status).toBe(403);
	});

	it("passes the request through when can() allows it", async () => {
		let canCalls = 0;
		const authz: AuthzConfig = {
			resolver: {
				can: async () => {
					canCalls++;
					return true;
				},
				listFilter: async () => null,
			},
			routes: [gateRoute],
		};
		const agent = new AINAgent({ name: "t", description: "t" }, { ...fakeModules(), authz });
		const r = await request(agent.app).get("/api/agent");
		expect(canCalls).toBe(1);
		expect(r.status).not.toBe(403);
	});

	it("does not gate any route when no authz is provided", async () => {
		const agent = new AINAgent({ name: "t", description: "t" }, { ...fakeModules() });
		const r = await request(agent.app).get("/api/agent");
		expect(r.status).not.toBe(403);
	});
});
