import {
	MAX_LIST_LIMIT,
	parseListOptions,
} from "@/utils/parse-list-options";

describe("parseListOptions", () => {
	it("returns undefined when limit is absent (legacy bare-array path)", () => {
		expect(parseListOptions({})).toBeUndefined();
		expect(parseListOptions({ offset: "10" })).toBeUndefined();
	});

	it("parses limit and offset", () => {
		expect(parseListOptions({ limit: "15", offset: "30" })).toEqual({
			limit: 15,
			offset: 30,
		});
	});

	it("defaults offset to 0", () => {
		expect(parseListOptions({ limit: "15" })).toEqual({ limit: 15, offset: 0 });
	});

	it("clamps limit to [1, MAX_LIST_LIMIT] and floors decimals", () => {
		expect(parseListOptions({ limit: "0" })).toEqual({ limit: 1, offset: 0 });
		expect(parseListOptions({ limit: "-5" })).toEqual({ limit: 1, offset: 0 });
		expect(parseListOptions({ limit: "9999" })).toEqual({
			limit: MAX_LIST_LIMIT,
			offset: 0,
		});
		expect(parseListOptions({ limit: "10.9" })).toEqual({ limit: 10, offset: 0 });
	});

	it("clamps negative offset to 0", () => {
		expect(parseListOptions({ limit: "10", offset: "-3" })).toEqual({
			limit: 10,
			offset: 0,
		});
	});

	it("returns undefined on unparseable limit", () => {
		expect(parseListOptions({ limit: "abc" })).toBeUndefined();
		expect(parseListOptions({ limit: ["10"] as never })).toBeUndefined();
	});

	it("ignores unparseable offset", () => {
		expect(parseListOptions({ limit: "10", offset: "abc" })).toEqual({
			limit: 10,
			offset: 0,
		});
	});
});
