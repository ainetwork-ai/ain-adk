import request from "supertest";
import { AINAgent } from "@/index";
import type { AuthModule, MemoryModule, ModelModule } from "@/modules";

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

describe("AINAgent request-context wiring", () => {
	it("assigns a request id to every request via the X-Request-Id header", async () => {
		const agent = new AINAgent(
			{ name: "test-agent", description: "test" },
			fakeModules(),
		);
		const res = await request(agent.app).get("/");
		expect(res.status).toBe(200);
		expect(res.headers["x-request-id"]).toBeDefined();
	});

	it("reuses the client-provided request id", async () => {
		const agent = new AINAgent(
			{ name: "test-agent", description: "test" },
			fakeModules(),
		);
		const res = await request(agent.app)
			.get("/")
			.set("X-Request-Id", "upstream-1");
		expect(res.headers["x-request-id"]).toBe("upstream-1");
	});
});
