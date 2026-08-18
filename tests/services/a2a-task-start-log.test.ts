import { A2AService } from "@/services/a2a.service";
import type { QueryService } from "@/services/query.service";
import { loggers } from "@/utils/logger";

const makeRequestContext = () =>
	({
		userMessage: {
			kind: "message",
			messageId: "m1",
			role: "user",
			contextId: "thread-e2bee4bd",
			metadata: { agentId: "agent-1", type: "CHAT" },
			parts: [{ kind: "text", text: "analyze daily sales" }],
		},
		task: undefined,
		// biome-ignore lint/suspicious/noExplicitAny: minimal A2A SDK stub
	}) as any;

describe("A2AService task start logging", () => {
	it("logs task receipt before query handling starts, so a hang leaves a trace", async () => {
		const infoSpy = jest
			.spyOn(loggers.server, "info")
			.mockReturnValue(loggers.server);

		let handleQueryCalled = false;
		const queryService = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			handleQuery: (..._args: any[]) => {
				handleQueryCalled = true;
				expect(infoSpy).toHaveBeenCalledWith(
					expect.stringContaining("started"),
					expect.objectContaining({ threadId: "thread-e2bee4bd" }),
				);
				return (async function* () {
					yield { event: "text_chunk", data: { delta: "ok" } };
				})();
			},
		} as unknown as QueryService;

		const service = new A2AService(queryService);
		const eventBus = { publish: jest.fn() };
		// biome-ignore lint/suspicious/noExplicitAny: minimal event bus stub
		await service.execute(makeRequestContext(), eventBus as any);

		expect(handleQueryCalled).toBe(true);
		infoSpy.mockRestore();
	});
});
