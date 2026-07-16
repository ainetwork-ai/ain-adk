import { JobRunnerService } from "@/services/job-runner.service";

/** 외부에서 완료를 제어할 수 있는 execute 함수 */
function deferred() {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("JobRunnerService", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it("runs a job to success on first attempt", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 2 });
		const outcome = await runner.submit({
			jobKey: "wf-1",
			execute: async () => {},
		});
		expect(outcome).toEqual({ status: "success", attempts: 1 });
	});

	it("skips overlapping submissions of the same jobKey", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 2 });
		const gate = deferred();
		const first = runner.submit({ jobKey: "wf-1", execute: () => gate.promise });
		const second = await runner.submit({ jobKey: "wf-1", execute: async () => {} });
		expect(second).toEqual({ status: "skipped_overlap", attempts: 0 });
		gate.resolve();
		await expect(first).resolves.toEqual({ status: "success", attempts: 1 });
	});

	it("limits concurrency and dispatches FIFO", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 1 });
		const order: string[] = [];
		const gateA = deferred();
		const a = runner.submit({
			jobKey: "a",
			execute: async () => {
				order.push("a-start");
				await gateA.promise;
			},
		});
		const b = runner.submit({
			jobKey: "b",
			execute: async () => {
				order.push("b-start");
			},
		});
		// b는 a가 끝나기 전엔 시작되지 않는다
		await new Promise((r) => setImmediate(r));
		expect(order).toEqual(["a-start"]);
		gateA.resolve();
		await Promise.all([a, b]);
		expect(order).toEqual(["a-start", "b-start"]);
	});

	it("fails immediately on non-retryable errors", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 2 });
		const outcome = await runner.submit({
			jobKey: "bad",
			execute: async () => {
				throw Object.assign(new Error("Not found"), { status: 404 });
			},
		});
		expect(outcome).toEqual({
			status: "failed",
			attempts: 1,
			error: "Not found",
		});
	});

	it("retries retryable errors with backoff then succeeds", async () => {
		jest.useFakeTimers();
		const runner = new JobRunnerService({
			maxConcurrent: 2,
			retryDelaysMs: [1000, 2000],
		});
		let calls = 0;
		const promise = runner.submit({
			jobKey: "flaky",
			execute: async () => {
				calls++;
				if (calls < 3) throw Object.assign(new Error("boom"), { status: 503 });
			},
		});
		await jest.advanceTimersByTimeAsync(1000); // 1차 백오프
		await jest.advanceTimersByTimeAsync(2000); // 2차 백오프
		await expect(promise).resolves.toEqual({ status: "success", attempts: 3 });
		expect(calls).toBe(3);
	});

	it("exhausts retries and reports failed with last error", async () => {
		jest.useFakeTimers();
		const runner = new JobRunnerService({
			maxConcurrent: 2,
			retryDelaysMs: [1000],
		});
		const promise = runner.submit({
			jobKey: "always-503",
			execute: async () => {
				throw Object.assign(new Error("unavailable"), { status: 503 });
			},
		});
		await jest.advanceTimersByTimeAsync(1000);
		await expect(promise).resolves.toEqual({
			status: "failed",
			attempts: 2,
			error: "unavailable",
		});
	});

	it("applies a global cooldown after a 429 (other jobs wait, no retry consumed)", async () => {
		jest.useFakeTimers();
		const runner = new JobRunnerService({
			maxConcurrent: 2,
			retryDelaysMs: [500],
			cooldownMs: 10_000,
		});
		let firstCalls = 0;
		const first = runner.submit({
			jobKey: "limited",
			execute: async () => {
				firstCalls++;
				if (firstCalls === 1)
					throw Object.assign(new Error("429"), { status: 429 });
			},
		});
		// 429 발생 → 쿨다운 활성화. 그 사이 제출된 두 번째 잡은 대기해야 한다.
		await jest.advanceTimersByTimeAsync(0);
		let secondRan = false;
		const second = runner.submit({
			jobKey: "other",
			execute: async () => {
				secondRan = true;
			},
		});
		await jest.advanceTimersByTimeAsync(5000);
		expect(secondRan).toBe(false); // 쿨다운 중
		await jest.advanceTimersByTimeAsync(6000); // 쿨다운(10s) 경과
		await expect(first).resolves.toEqual({ status: "success", attempts: 2 });
		await expect(second).resolves.toEqual({ status: "success", attempts: 1 });
		expect(secondRan).toBe(true);
	});

	it("honors Retry-After for the retry delay", async () => {
		jest.useFakeTimers();
		const runner = new JobRunnerService({
			maxConcurrent: 2,
			retryDelaysMs: [60_000], // Retry-After(3s)가 이보다 우선해야 함
			cooldownMs: 1,
		});
		let calls = 0;
		const promise = runner.submit({
			jobKey: "ra",
			execute: async () => {
				calls++;
				if (calls === 1)
					throw Object.assign(new Error("429"), {
						status: 429,
						headers: { "retry-after": "3" },
					});
			},
		});
		await jest.advanceTimersByTimeAsync(3000);
		await expect(promise).resolves.toEqual({ status: "success", attempts: 2 });
	});

	it("drain with zero in-flight jobs resolves promptly and leaves no open handle", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 2 });
		const started = Date.now();
		await runner.drain(30_000);
		expect(Date.now() - started).toBeLessThan(1000);
	});

	describe("SCHEDULER_MAX_CONCURRENT env guard", () => {
		const ORIGINAL_ENV = process.env.SCHEDULER_MAX_CONCURRENT;

		afterEach(() => {
			if (ORIGINAL_ENV === undefined) {
				delete process.env.SCHEDULER_MAX_CONCURRENT;
			} else {
				process.env.SCHEDULER_MAX_CONCURRENT = ORIGINAL_ENV;
			}
		});

		it("falls back to 2 and still executes when the env value is not a number", async () => {
			process.env.SCHEDULER_MAX_CONCURRENT = "abc";
			const runner = new JobRunnerService();
			const outcome = await runner.submit({
				jobKey: "wf-1",
				execute: async () => {},
			});
			expect(outcome).toEqual({ status: "success", attempts: 1 });
		});

		it("falls back to 2 and still executes when the env value is 0", async () => {
			process.env.SCHEDULER_MAX_CONCURRENT = "0";
			const runner = new JobRunnerService();
			const outcome = await runner.submit({
				jobKey: "wf-1",
				execute: async () => {},
			});
			expect(outcome).toEqual({ status: "success", attempts: 1 });
		});
	});

	it("drain waits for in-flight jobs", async () => {
		const runner = new JobRunnerService({ maxConcurrent: 2 });
		const gate = deferred();
		let finished = false;
		const job = runner.submit({
			jobKey: "slow",
			execute: async () => {
				await gate.promise;
				finished = true;
			},
		});
		const drain = runner.drain(60_000);
		gate.resolve();
		await drain;
		expect(finished).toBe(true);
		await job;
	});
});
