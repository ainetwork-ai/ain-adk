import { normalizeQueryRequest } from "@/utils/query-input";

describe("normalizeQueryRequest", () => {
	it("supports legacy message input", () => {
		const result = normalizeQueryRequest(
			{
				message: "hello world",
				displayMessage: "Hello",
			},
			{ artifactModuleConfigured: false },
		);

		expect(result.query).toBe("hello world");
		expect(result.displayQuery).toBe("Hello");
		expect(result.input.parts).toEqual([{ kind: "text", text: "hello world" }]);
	});

	it("supports structured text input", () => {
		const result = normalizeQueryRequest(
			{
				input: {
					parts: [
						{ kind: "text", text: "Summarize this" },
						{ kind: "text", text: "Please keep it short" },
					],
				},
			},
			{ artifactModuleConfigured: false },
		);

		expect(result.query).toBe("Summarize this\nPlease keep it short");
	});

	it("serializes structured artifact input using preview text", () => {
		const result = normalizeQueryRequest(
			{
				input: {
					parts: [
						{ kind: "text", text: "Summarize this report" },
						{
							kind: "artifact",
							artifactId: "art_123",
							name: "report.pdf",
							previewText: "Quarterly revenue increased by 20 percent.",
						},
					],
				},
			},
			{ artifactModuleConfigured: true },
		);

		expect(result.query).toBe(
			"Summarize this report\nQuarterly revenue increased by 20 percent.",
		);
	});

	it("serializes structured artifact input without preview using shared fallback formatting", () => {
		const result = normalizeQueryRequest(
			{
				input: {
					parts: [
						{
							kind: "artifact",
							artifactId: "art_456",
							name: "report.pdf",
							mimeType: "application/pdf",
							size: 2048,
						},
					],
				},
			},
			{ artifactModuleConfigured: true },
		);

		expect(result.query).toBe(
			"[Artifact: report.pdf (application/pdf, 2048 bytes)]",
		);
	});

	it("serializes structured data input using shared fallback formatting", () => {
		const result = normalizeQueryRequest(
			{
				input: {
					parts: [
						{
							kind: "data",
							mimeType: "application/json",
							data: { total: 3 },
						},
					],
				},
			},
			{ artifactModuleConfigured: false },
		);

		expect(result.query).toBe('application/json: {"total":3}');
	});

	it("rejects artifact input when artifact storage is not configured", () => {
		expect(() =>
			normalizeQueryRequest(
				{
					input: {
						parts: [{ kind: "artifact", artifactId: "art_123" }],
					},
				},
				{ artifactModuleConfigured: false },
			),
		).toThrow("Artifact input requires an artifact module to be configured.");
	});

	it("rejects malformed structured input", () => {
		expect(() =>
			normalizeQueryRequest(
				{
					input: {
						parts: [{ kind: "text" }],
					},
				},
				{ artifactModuleConfigured: false },
			),
		).toThrow("Text parts require a string 'text' field.");
	});
});
