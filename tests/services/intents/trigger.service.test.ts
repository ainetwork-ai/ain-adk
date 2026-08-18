import { IntentTriggerService } from "@/services/intents/trigger.service";
import { MessageRole, ThreadType } from "@/types/memory";

type ModelCall = { systemPrompt: string; query: string };

function buildMocks(opts: {
	fetchContent?: string | null;
	intents?: Array<{ name: string; description?: string }>;
	intentMemoryMissing?: boolean;
}) {
	const fetchCalls: ModelCall[] = [];
	const generateMessagesCalls: ModelCall[] = [];

	const generateMessages = jest.fn(
		({ systemPrompt, query }: { systemPrompt: string; query: string }) => {
			generateMessagesCalls.push({ systemPrompt, query });
			return [];
		},
	);
	const fetch = jest.fn(async () => ({
		content: opts.fetchContent === undefined ? "{}" : opts.fetchContent,
	}));

	const listIntents = jest.fn(async () => opts.intents ?? []);
	const getIntentByName = jest.fn(async (name: string) => ({
		id: `id-${name}`,
		name,
		description: `desc-${name}`,
	}));

	const modelModule = {
		getModel: () => ({ generateMessages, fetch }),
		getModelOptions: () => undefined,
	};
	const memoryModule = {
		getIntentMemory: opts.intentMemoryMissing
			? () => undefined
			: () => ({ listIntents, getIntentByName }),
		getAgentMemory: () => ({}),
	};

	return {
		modelModule,
		memoryModule,
		fetch,
		generateMessages,
		listIntents,
		getIntentByName,
		fetchCalls,
		generateMessagesCalls,
	};
}

describe("IntentTriggerService", () => {
	const originalEnv = process.env.DISABLE_MULTI_INTENTS;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.DISABLE_MULTI_INTENTS;
		} else {
			process.env.DISABLE_MULTI_INTENTS = originalEnv;
		}
	});

	describe("common fallback paths", () => {
		it("returns the original query as a single subquery when intent memory is missing", async () => {
			const mocks = buildMocks({ intentMemoryMissing: true });
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("hello", undefined);

			expect(result).toEqual({
				intents: [{ subquery: "hello" }],
				needsAggregation: false,
			});
			expect(mocks.fetch).not.toHaveBeenCalled();
		});

		it("returns fallback when intent list is empty", async () => {
			const mocks = buildMocks({ intents: [] });
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("hello", undefined);

			expect(result).toEqual({
				intents: [{ subquery: "hello" }],
				needsAggregation: false,
			});
			expect(mocks.fetch).not.toHaveBeenCalled();
		});

		it("returns fallback when the model response has no content", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: "",
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("hello", undefined);

			expect(result).toEqual({
				intents: [{ subquery: "hello" }],
				needsAggregation: false,
			});
		});

		it("returns fallback when the model response is not valid JSON", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: "not-json",
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("hello", undefined);

			expect(result).toEqual({
				intents: [{ subquery: "hello" }],
				needsAggregation: false,
			});
		});
	});

	describe("single-intent mode", () => {
		beforeEach(() => {
			process.env.DISABLE_MULTI_INTENTS = "true";
		});

		it("returns one intent with the original query as subquery and resolves the intent by name", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "find stuff" }],
				fetchContent: JSON.stringify({
					intentName: "search",
					actionPlan: "look it up",
				}),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering(
				"find the answer",
				undefined,
			);

			expect(result.needsAggregation).toBe(false);
			expect(result.intents).toHaveLength(1);
			expect(result.intents[0]).toMatchObject({
				subquery: "find the answer",
				actionPlan: "look it up",
				intent: { name: "search" },
			});
			expect(mocks.getIntentByName).toHaveBeenCalledWith("search");
		});

		it("leaves the intent unset when intentName is missing", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({ actionPlan: "no match" }),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("anything", undefined);

			expect(result.intents).toHaveLength(1);
			expect(result.intents[0]).toEqual({
				subquery: "anything",
				actionPlan: "no match",
			});
			expect(mocks.getIntentByName).not.toHaveBeenCalled();
		});

		it("uses the single-intent prompt and trigger message template", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({ intentName: "search" }),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			await service.intentTriggering("hello", undefined);

			const call = mocks.generateMessages.mock.calls[0]?.[0];
			expect(call.systemPrompt).toContain("single most appropriate intent");
			expect(call.query).toContain("User question:");
			expect(call.query).not.toContain("Last user question:");
		});
	});

	describe("multi-intent mode", () => {
		it("maps every subquery, looks up named intents, and preserves needsAggregation", async () => {
			const mocks = buildMocks({
				intents: [
					{ name: "search", description: "" },
					{ name: "summarize", description: "" },
				],
				fetchContent: JSON.stringify({
					needsAggregation: true,
					subqueries: [
						{
							subquery: "find docs",
							intentName: "search",
							actionPlan: "do a search",
						},
						{
							subquery: "summarize them",
							intentName: "summarize",
							actionPlan: "summarize",
						},
					],
				}),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering(
				"find docs and summarize",
				undefined,
			);

			expect(result.needsAggregation).toBe(true);
			expect(result.intents).toHaveLength(2);
			expect(result.intents[0]).toMatchObject({
				subquery: "find docs",
				intent: { name: "search" },
			});
			expect(result.intents[1]).toMatchObject({
				subquery: "summarize them",
				intent: { name: "summarize" },
			});
			expect(mocks.getIntentByName).toHaveBeenCalledTimes(2);
		});

		it("filters out subqueries that are missing the subquery field", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({
					needsAggregation: false,
					subqueries: [
						{ subquery: "real", intentName: "search" },
						{ intentName: "search" },
						{ subquery: "" },
					],
				}),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("query", undefined);

			expect(result.intents.map((i) => i.subquery)).toEqual(["real"]);
		});

		it("defaults needsAggregation to false and subqueries to empty when missing in the response", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({}),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			const result = await service.intentTriggering("query", undefined);

			expect(result).toEqual({ intents: [], needsAggregation: false });
		});

		it("uses the multi-intent prompt and trigger message template", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({ subqueries: [] }),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			await service.intentTriggering("hello", undefined);

			const call = mocks.generateMessages.mock.calls[0]?.[0];
			expect(call.systemPrompt).toContain("Decompose the question");
			expect(call.query).toContain("Last user question:");
			expect(call.query).not.toContain('"User question:');
		});
	});

	describe("conversation history preamble", () => {
		it("includes serialized thread messages in the trigger message when a thread is provided", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({ subqueries: [] }),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			await service.intentTriggering("now", {
				userId: "u",
				threadId: "t",
				type: ThreadType.CHAT,
				title: "",
				messages: [
					{
						messageId: "m1",
						role: MessageRole.USER,
						timestamp: 1,
						schemaVersion: 2,
						parts: [{ kind: "text", text: "earlier" }],
					},
				],
			} as any);

			const call = mocks.generateMessages.mock.calls[0]?.[0];
			expect(call.query).toContain("conversation history with the user");
			expect(call.query).toContain("earlier");
		});

		it("omits the history preamble when no thread is provided", async () => {
			const mocks = buildMocks({
				intents: [{ name: "search", description: "" }],
				fetchContent: JSON.stringify({ subqueries: [] }),
			});
			const service = new IntentTriggerService(
				mocks.modelModule as any,
				mocks.memoryModule as any,
			);

			await service.intentTriggering("now", undefined);

			const call = mocks.generateMessages.mock.calls[0]?.[0];
			expect(call.query).not.toContain("conversation history with the user");
		});
	});
});
