import { classifyJobError } from "@/utils/job-error";

describe("classifyJobError", () => {
	it("classifies 429 as retryable + rateLimited", () => {
		expect(classifyJobError({ status: 429 })).toEqual({
			retryable: true,
			rateLimited: true,
			retryAfterMs: undefined,
		});
	});

	it("extracts Retry-After seconds into retryAfterMs", () => {
		const error = {
			status: 429,
			headers: { "retry-after": "17" },
		};
		expect(classifyJobError(error).retryAfterMs).toBe(17_000);
	});

	it("reads status from statusCode and response.status", () => {
		expect(classifyJobError({ statusCode: 503 }).retryable).toBe(true);
		expect(classifyJobError({ response: { status: 500 } }).retryable).toBe(true);
	});

	it("classifies 5xx as retryable but not rateLimited", () => {
		expect(classifyJobError({ status: 500 })).toEqual({
			retryable: true,
			rateLimited: false,
		});
	});

	it("classifies 4xx (except 429) as non-retryable", () => {
		for (const status of [400, 401, 403, 404]) {
			expect(classifyJobError({ status }).retryable).toBe(false);
		}
	});

	it("classifies network error codes as retryable", () => {
		for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"]) {
			expect(classifyJobError({ code }).retryable).toBe(true);
		}
	});

	it("falls back to message matching for rate limits and timeouts", () => {
		expect(classifyJobError(new Error("Rate limit exceeded")).rateLimited).toBe(true);
		expect(classifyJobError(new Error("Request timed out")).retryable).toBe(true);
	});

	it("defaults unknown errors to non-retryable", () => {
		expect(classifyJobError(new Error("workflow has no definition"))).toEqual({
			retryable: false,
			rateLimited: false,
		});
		expect(classifyJobError(undefined).retryable).toBe(false);
	});
});
