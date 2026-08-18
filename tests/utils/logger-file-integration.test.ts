import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLogger } from "@/utils/logger";
import { runWithRequestContext } from "@/utils/request-context";

// Pins the composed format chain end-to-end: real DailyRotateFile
// transport, JSON mode, context injection and Error serialization all at
// once — the individual format units are tested elsewhere, but ordering
// bugs only show up in the composition.
describe("file logging integration", () => {
	const originalPath = process.env.LOG_FILE_PATH;
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "adk-log-itest-"));
		process.env.LOG_FILE_PATH = path.join(dir, "itest-log");
	});

	afterEach(() => {
		if (originalPath === undefined) delete process.env.LOG_FILE_PATH;
		else process.env.LOG_FILE_PATH = originalPath;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("writes a parseable .jsonl line carrying context and a real error string", async () => {
		const logger = getLogger("ITest");
		runWithRequestContext({ requestId: "req-int-1", userId: "u1" }, () => {
			logger.error("integration line", { error: new Error("real cause") });
		});

		let lastLine = "";
		const deadline = Date.now() + 4000;
		while (Date.now() < deadline) {
			const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
			if (files.length > 0) {
				const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
				if (content.includes("integration line")) {
					lastLine = content.trim().split("\n").at(-1) ?? "";
					break;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		logger.close();

		expect(lastLine).not.toBe("");
		const parsed = JSON.parse(lastLine);
		expect(parsed).toMatchObject({
			level: "error",
			message: "integration line",
			service: "ITest",
			requestId: "req-int-1",
			userId: "u1",
		});
		expect(typeof parsed.timestamp).toBe("string");
		expect(typeof parsed.error).toBe("string");
		expect(parsed.error).toContain("real cause");
	});
});
