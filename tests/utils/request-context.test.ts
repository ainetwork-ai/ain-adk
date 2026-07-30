import {
	getRequestContext,
	runWithRequestContext,
	updateRequestContext,
} from "@/utils/request-context";

describe("request-context", () => {
	it("returns undefined outside of a context", () => {
		expect(getRequestContext()).toBeUndefined();
	});

	it("exposes the context inside runWithRequestContext", () => {
		runWithRequestContext({ requestId: "req-1" }, () => {
			expect(getRequestContext()).toEqual({ requestId: "req-1" });
		});
	});

	it("keeps the context across await boundaries", async () => {
		await runWithRequestContext({ requestId: "req-async" }, async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(getRequestContext()?.requestId).toBe("req-async");
		});
	});

	it("isolates concurrent contexts from each other", async () => {
		const seen: string[] = [];
		const task = (id: string, delay: number) =>
			runWithRequestContext({ requestId: id }, async () => {
				await new Promise((resolve) => setTimeout(resolve, delay));
				seen.push(getRequestContext()?.requestId ?? "lost");
			});
		await Promise.all([task("req-a", 10), task("req-b", 1)]);
		expect(seen.sort()).toEqual(["req-a", "req-b"]);
	});

	it("merges values into the current context with updateRequestContext", () => {
		runWithRequestContext({ requestId: "req-2" }, () => {
			updateRequestContext({ userId: "user-1", threadId: "thread-1" });
			expect(getRequestContext()).toEqual({
				requestId: "req-2",
				userId: "user-1",
				threadId: "thread-1",
			});
		});
	});

	it("is a no-op when updating outside of a context", () => {
		expect(() => updateRequestContext({ userId: "user-x" })).not.toThrow();
		expect(getRequestContext()).toBeUndefined();
	});
});
