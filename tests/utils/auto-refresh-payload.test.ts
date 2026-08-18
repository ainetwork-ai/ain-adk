import { parseAutoRefreshPayload } from "@/utils/auto-refresh-payload";

describe("parseAutoRefreshPayload", () => {
	it("parses a valid payload (client cannot set done/completed)", () => {
		expect(
			parseAutoRefreshPayload({
				autoRefresh: {
					runAt: 1750000000000,
					active: true,
					slotIds: ["s1"],
					doneSlotIds: ["hacked"],
					completedAt: 1,
				},
			}),
		).toEqual({ runAt: 1750000000000, active: true, slotIds: ["s1"] });
	});

	it("returns null for clearing payloads", () => {
		expect(parseAutoRefreshPayload({ autoRefresh: null })).toBeNull();
		expect(parseAutoRefreshPayload({})).toBeNull();
		expect(parseAutoRefreshPayload(null)).toBeNull();
	});

	it("rejects invalid runAt/active/slotIds", () => {
		expect(() =>
			parseAutoRefreshPayload({ autoRefresh: { runAt: "soon", active: true } }),
		).toThrow(/runAt/);
		expect(() =>
			parseAutoRefreshPayload({ autoRefresh: { runAt: 1, active: "yes" } }),
		).toThrow(/active/);
		expect(() =>
			parseAutoRefreshPayload({
				autoRefresh: { runAt: 1, active: true, slotIds: [1] },
			}),
		).toThrow(/slotIds/);
	});
});
