import { interceptConsole, restoreConsole } from "@/utils/logger";

describe("interceptConsole", () => {
	const originalLog = console.log;
	const originalPath = process.env.LOG_FILE_PATH;

	afterEach(() => {
		restoreConsole();
		if (originalPath === undefined) delete process.env.LOG_FILE_PATH;
		else process.env.LOG_FILE_PATH = originalPath;
	});

	it("does nothing when LOG_FILE_PATH is not set", () => {
		delete process.env.LOG_FILE_PATH;
		expect(interceptConsole()).toBeUndefined();
		expect(console.log).toBe(originalLog);
	});

	it("routes console output to a winston logger while keeping stdout", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		const consoleLogger = interceptConsole();
		expect(consoleLogger).toBeDefined();
		if (!consoleLogger) throw new Error("unreachable");

		const infoSpy = jest
			.spyOn(consoleLogger, "info")
			.mockReturnValue(consoleLogger);
		const warnSpy = jest
			.spyOn(consoleLogger, "warn")
			.mockReturnValue(consoleLogger);

		console.log("server started on port", 8080);
		console.warn("careful");

		expect(infoSpy).toHaveBeenCalledWith("server started on port 8080");
		expect(warnSpy).toHaveBeenCalledWith("careful");
	});

	it("renders non-string arguments readably instead of [object Object]", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		const consoleLogger = interceptConsole();
		if (!consoleLogger) throw new Error("unreachable");
		const infoSpy = jest
			.spyOn(consoleLogger, "info")
			.mockReturnValue(consoleLogger);

		console.log("config:", { port: 8080 });

		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining("port: 8080"),
		);
		expect(infoSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("[object Object]"),
		);
	});

	it("is idempotent: a second call does not stack wrappers", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		interceptConsole();
		const patched = console.log;
		expect(interceptConsole()).toBeUndefined();
		expect(console.log).toBe(patched);
	});

	it("does not recurse when the mirror path itself writes to the console", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		const consoleLogger = interceptConsole();
		if (!consoleLogger) throw new Error("unreachable");

		// Simulate winston/transport error handling calling console.error
		// from inside the mirror write — without a guard this recurses
		// until the stack overflows.
		const errorSpy = jest
			.spyOn(consoleLogger, "error")
			.mockImplementation((() => {
				console.error("transport failure");
				return consoleLogger;
			}) as never);

		expect(() => console.error("original failure")).not.toThrow();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it("restoreConsole puts the original console back", () => {
		process.env.LOG_FILE_PATH = "/tmp/ain-adk-test-log";
		interceptConsole();
		expect(console.log).not.toBe(originalLog);
		restoreConsole();
		expect(console.log).toBe(originalLog);
	});
});
