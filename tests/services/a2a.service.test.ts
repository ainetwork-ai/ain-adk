import { A2AService } from "@/services/a2a.service";
import { MessageRole, ThreadType } from "@/types/memory";
import { createTextMessage } from "@/utils/message";

describe("A2AService", () => {
	it("falls back to message_complete when compatibility text chunks are absent", async () => {
		const finalMessage = createTextMessage({
			messageId: "msg-1",
			role: MessageRole.MODEL,
			timestamp: 123,
			text: "final response",
		});

		const a2aService = new A2AService({
			handleQuery: async function* () {
				yield {
					event: "message_start" as const,
					data: {
						messageId: finalMessage.messageId,
						role: MessageRole.MODEL,
					},
				};
				yield {
					event: "part_delta" as const,
					data: {
						messageId: finalMessage.messageId,
						partIndex: 0,
						part: { kind: "text" as const },
						delta: "final response",
					},
				};
				yield {
					event: "message_complete" as const,
					data: { message: finalMessage },
				};
				return finalMessage;
			},
		} as any);

		const publish = jest.fn();
		await a2aService.execute(
			{
				userMessage: {
					contextId: "thread-1",
					metadata: {
						agentId: "agent-1",
						type: ThreadType.CHAT,
					},
					parts: [{ kind: "text", text: "hello" }],
				},
			} as any,
			{ publish } as any,
		);

		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish.mock.calls[1][0]).toMatchObject({
			kind: "status-update",
			contextId: "thread-1",
			status: {
				state: "completed",
				message: {
					parts: [{ kind: "text", text: "final response" }],
				},
			},
			final: true,
		});
	});

	it("maps inbound file parts to structured input and publishes artifact updates", async () => {
		const finalMessage = {
			messageId: "msg-2",
			role: MessageRole.MODEL,
			timestamp: 456,
			schemaVersion: 2 as const,
			parts: [
				{ kind: "text" as const, text: "summary ready" },
				{
					kind: "artifact" as const,
					artifactId: "art-1",
					name: "report.pdf",
					mimeType: "application/pdf",
					size: 1024,
					downloadUrl: "https://agent.example/artifacts/art-1/download",
					previewText: "Quarterly report preview",
				},
			],
		};

		const handleQuery = jest.fn(async function* (_threadMetadata, queryData) {
			expect(queryData.input).toEqual({
				parts: [
					{ kind: "text", text: "Summarize this file" },
					{
						kind: "artifact",
						artifactId: "peer-art-1",
						name: "report.pdf",
						mimeType: "application/pdf",
						size: 1024,
						downloadUrl: "https://peer.example/report.pdf",
						previewText: "Quarterly results preview",
					},
				],
			});
			expect(queryData.query).toContain("Summarize this file");
			expect(queryData.query).toContain("Quarterly results preview");

			yield {
				event: "message_complete" as const,
				data: { message: finalMessage },
			};
			return finalMessage;
		});

		const a2aService = new A2AService({
			handleQuery,
		} as any);

		const publish = jest.fn();
		await a2aService.execute(
			{
				userMessage: {
					metadata: {
						agentId: "agent-1",
						type: ThreadType.CHAT,
					},
					parts: [
						{ kind: "text", text: "Summarize this file" },
						{
							kind: "file",
							file: {
								uri: "https://peer.example/report.pdf",
								name: "report.pdf",
								mimeType: "application/pdf",
							},
							metadata: {
								artifactId: "peer-art-1",
								size: 1024,
								previewText: "Quarterly results preview",
							},
						},
					],
				},
			} as any,
			{ publish } as any,
		);

		expect(handleQuery).toHaveBeenCalledTimes(1);
		expect(publish.mock.calls[0][0]).toMatchObject({
			kind: "task",
			status: { state: "submitted" },
		});
		expect(publish.mock.calls[1][0]).toMatchObject({
			kind: "artifact-update",
			artifact: {
				artifactId: "art-1",
				name: "report.pdf",
				parts: [
					{ kind: "text", text: "Quarterly report preview" },
					{
						kind: "file",
						file: {
							uri: "https://agent.example/artifacts/art-1/download",
							name: "report.pdf",
							mimeType: "application/pdf",
						},
					},
				],
			},
		});
		expect(publish.mock.calls[2][0]).toMatchObject({
			kind: "status-update",
			status: {
				state: "completed",
				message: {
					parts: [
						{ kind: "text", text: "summary ready" },
						{
							kind: "file",
							file: {
								uri: "https://agent.example/artifacts/art-1/download",
								name: "report.pdf",
								mimeType: "application/pdf",
							},
						},
					],
				},
			},
			final: true,
		});
	});
});
