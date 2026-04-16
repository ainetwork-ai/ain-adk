import { setManifest } from "@/config/manifest";
import { AggregateService } from "@/services/intents/aggregate.service";
import { MessageRole } from "@/types/memory";
import { createTextMessage } from "@/utils/message";

describe("AggregateService", () => {
	beforeEach(() => {
		setManifest({
			name: "Test Agent",
			description: "Test agent",
		});
	});

	it("serializes canonical fulfillment messages when building aggregate prompts", async () => {
		let aggregateQuery = "";

		const service = new AggregateService(
			{
				getModel: () => ({
					generateMessages: ({ query }: { query: string }) => {
						aggregateQuery = query;
						return [];
					},
					fetchStreamWithContextMessage: async () => ({
						async *[Symbol.asyncIterator]() {
							yield {
								delta: {
									content: "combined reply",
								},
							};
						},
					}),
				}),
				getModelOptions: () => undefined,
			} as any,
			{
				getAgentMemory: () => ({
					getAggregatePrompt: async () => "aggregate prompt",
				}),
			} as any,
		);

		const stream = service.aggregate("summarize everything", [
			{
				subquery: "summarize file",
				response: "legacy text should not be used",
				responseMessage: {
					messageId: "message-1",
					role: MessageRole.MODEL,
					timestamp: 100,
					schemaVersion: 2,
					parts: [
						{
							kind: "artifact",
							artifactId: "artifact-1",
							name: "summary.csv",
							previewText: "canonical artifact preview",
						},
					],
				},
			},
			{
				subquery: "summarize text",
				response: "legacy text should not be used either",
				responseMessage: createTextMessage({
					messageId: "message-2",
					role: MessageRole.MODEL,
					timestamp: 200,
					text: "canonical text result",
				}),
			},
		]);

		const events = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(aggregateQuery).toContain("canonical artifact preview");
		expect(aggregateQuery).toContain("canonical text result");
		expect(aggregateQuery).not.toContain("legacy text should not be used");
		expect(events).toEqual([
			expect.objectContaining({ event: "thinking_process" }),
			{ event: "text_chunk", data: { delta: "combined reply" } },
		]);
	});

	it("keeps legacy fulfillment result text as a fallback", async () => {
		const service = new AggregateService(
			{
				getModel: () => ({
					generateMessages: () => [],
					fetchStreamWithContextMessage: async () => ({
						async *[Symbol.asyncIterator]() {
							yield {
								delta: {
									content: "unused",
								},
							};
						},
					}),
				}),
				getModelOptions: () => undefined,
			} as any,
			{} as any,
		);

		const stream = service.aggregate("summarize", [
			{
				subquery: "legacy",
				response: "legacy fallback text",
			},
		]);

		await expect(stream.next()).resolves.toEqual({
			done: false,
			value: {
				event: "text_chunk",
				data: { delta: "legacy fallback text" },
			},
		});
		await expect(stream.next()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});
});
