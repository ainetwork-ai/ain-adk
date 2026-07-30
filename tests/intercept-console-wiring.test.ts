import { AINAgent } from "@/index";
import type { AuthModule, MemoryModule, ModelModule } from "@/modules";
import { restoreConsole } from "@/utils/logger";

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

describe("AINAgent console interception wiring", () => {
	const originalLog = console.log;
	const originalPath = process.env.LOG_FILE_PATH;

	afterEach(() => {
		restoreConsole();
		if (originalPath === undefined) delete process.env.LOG_FILE_PATH;
		else process.env.LOG_FILE_PATH = originalPath;
	});

	it("intercepts console output when LOG_FILE_PATH is set", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		new AINAgent({ name: "test-agent", description: "test" }, fakeModules());
		expect(console.log).not.toBe(originalLog);
	});

	it("leaves console untouched without LOG_FILE_PATH", () => {
		delete process.env.LOG_FILE_PATH;
		new AINAgent({ name: "test-agent", description: "test" }, fakeModules());
		expect(console.log).toBe(originalLog);
	});
});
