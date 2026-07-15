import { parseScheduleRunListQuery } from "@/routes/api/schedule-run.routes";
import { AinHttpError } from "@/types/agent";

describe("parseScheduleRunListQuery", () => {
	it("passes valid params through as the filter + clamped limit", () => {
		expect(
			parseScheduleRunListQuery({
				jobType: "WORKFLOW",
				jobKey: "wf-1",
				status: "failed",
				limit: "5",
			}),
		).toEqual({
			filter: { jobType: "WORKFLOW", jobKey: "wf-1", status: "failed" },
			limit: 5,
		});
	});

	it("defaults: absent params → no filter, limit 20; limit clamped to [1, 100]", () => {
		expect(parseScheduleRunListQuery({})).toEqual({
			filter: { jobType: undefined, jobKey: undefined, status: undefined },
			limit: 20,
		});
		expect(parseScheduleRunListQuery({ limit: "9999" }).limit).toBe(100);
		expect(parseScheduleRunListQuery({ limit: "0" }).limit).toBe(1);
		expect(parseScheduleRunListQuery({ limit: "abc" }).limit).toBe(20);
	});

	it("rejects an invalid jobType/status enum value with 400", () => {
		expect(() => parseScheduleRunListQuery({ jobType: "BOGUS" })).toThrow(
			/invalid jobType: BOGUS/,
		);
		expect(() => parseScheduleRunListQuery({ status: "exploded" })).toThrow(
			/invalid status: exploded/,
		);
		try {
			parseScheduleRunListQuery({ jobType: "BOGUS" });
			throw new Error("expected to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(AinHttpError);
			expect((error as AinHttpError).status).toBe(400);
		}
	});

	it("rejects array params (repeated query keys) with 400", () => {
		expect(() =>
			parseScheduleRunListQuery({ jobType: ["WORKFLOW", "SLOT_REFRESH"] }),
		).toThrow(/invalid jobType/);
		expect(() => parseScheduleRunListQuery({ jobKey: ["a", "b"] })).toThrow(
			/invalid jobKey/,
		);
		expect(() =>
			parseScheduleRunListQuery({ status: ["running", "failed"] }),
		).toThrow(/invalid status/);
	});
});
