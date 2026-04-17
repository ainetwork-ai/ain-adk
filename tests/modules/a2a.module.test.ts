import { A2AConnector } from "@/modules/a2a/a2a.connector";
import { A2AModule } from "@/modules/a2a/a2a.module";
import { CONNECTOR_PROTOCOL_TYPE } from "@/types/connector";

describe("A2AModule", () => {
	it("emits artifact_ready when a remote peer returns artifact references", async () => {
		const a2aModule = new A2AModule();
		const connector = new A2AConnector("peer", "https://peer.example");

		connector.client = {
			sendMessageStream: async function* () {
				yield {
					kind: "task",
					id: "task-1",
					contextId: "thread-1",
					status: {
						state: "submitted",
						timestamp: new Date().toISOString(),
					},
				};
				yield {
					kind: "status-update",
					taskId: "task-1",
					contextId: "thread-1",
					final: false,
					status: {
						state: "working",
						timestamp: new Date().toISOString(),
						message: {
							kind: "message",
							role: "agent",
							messageId: "msg-working",
							taskId: "task-1",
							contextId: "thread-1",
							parts: [
								{
									kind: "text",
									text: JSON.stringify({
										title: "Thinking",
										description: "Collecting data",
									}),
								},
							],
						},
					},
				};
				yield {
					kind: "artifact-update",
					taskId: "task-1",
					contextId: "thread-1",
					lastChunk: true,
					artifact: {
						artifactId: "art-1",
						name: "report.pdf",
						metadata: {
							artifactId: "art-1",
							size: 1024,
							previewText: "Artifact preview",
							downloadUrl: "https://peer.example/report.pdf",
						},
						parts: [
							{ kind: "text", text: "Artifact preview" },
							{
								kind: "file",
								file: {
									uri: "https://peer.example/report.pdf",
									name: "report.pdf",
									mimeType: "application/pdf",
								},
								metadata: {
									artifactId: "art-1",
									size: 1024,
									previewText: "Artifact preview",
									downloadUrl: "https://peer.example/report.pdf",
								},
							},
						],
					},
				};
				yield {
					kind: "status-update",
					taskId: "task-1",
					contextId: "thread-1",
					final: true,
					status: {
						state: "completed",
						timestamp: new Date().toISOString(),
						message: {
							kind: "message",
							role: "agent",
							messageId: "msg-complete",
							taskId: "task-1",
							contextId: "thread-1",
							parts: [
								{ kind: "text", text: "Here is the summary" },
								{
									kind: "file",
									file: {
										uri: "https://peer.example/report.pdf",
										name: "report.pdf",
										mimeType: "application/pdf",
									},
									metadata: {
										artifactId: "art-1",
										size: 1024,
										previewText: "Artifact preview",
										downloadUrl: "https://peer.example/report.pdf",
									},
								},
							],
						},
					},
				};
			},
		} as any;

		(a2aModule as any).a2aConnectors.set("peer", connector);

		const stream = a2aModule.useTool(
			{
				toolName: "peer-tool",
				connectorName: "peer",
				protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
			},
			"hello",
			"thread-1",
		);

		const events = [];
		let result = await stream.next();
		while (!result.done) {
			events.push(result.value);
			result = await stream.next();
		}

		expect(events).toEqual([
			{
				event: "thinking_process",
				data: {
					title: "Thinking",
					description: "Collecting data",
				},
			},
			{
				event: "artifact_ready",
				data: {
					kind: "artifact",
					artifactId: "art-1",
					name: "report.pdf",
					mimeType: "application/pdf",
					size: 1024,
					downloadUrl: "https://peer.example/report.pdf",
					previewText: "Artifact preview",
				},
			},
			{
				event: "text_chunk",
				data: {
					delta: "Here is the summary\nArtifact preview",
				},
			},
		]);
		expect(result.value).toBe(
			"[Bot Called A2A Tool peer-tool]\nArtifact preview\nHere is the summary\nArtifact preview",
		);
	});
});
