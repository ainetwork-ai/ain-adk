import { MessageRole, type MessageObject } from "@/types/memory";
import { messageToPromptText } from "@/utils/message-content";

function makeMessage(
	content: { type: string; parts: unknown[] },
	metadata?: Record<string, unknown>,
): MessageObject {
	return {
		messageId: "m1",
		role: MessageRole.MODEL,
		timestamp: 0,
		content,
		metadata,
	} as unknown as MessageObject;
}

describe("messageToPromptText", () => {
	it("returns the string part of a legacy text message unchanged", () => {
		expect(
			messageToPromptText(makeMessage({ type: "text", parts: ["안녕하세요"] })),
		).toBe("안녕하세요");
	});

	// Regression: a workflow run persists { type: "rich", parts: [DocumentPart] }.
	// Passing that object straight through as chat `content` made Azure reject the
	// whole request with 400 "Invalid type for 'messages[N].content'".
	it("renders a document part as a label, never an object", () => {
		const text = messageToPromptText(
			makeMessage({
				type: "rich",
				parts: [{ type: "document", documentId: "doc-1", title: "7월 리포트" }],
			}),
		);
		expect(typeof text).toBe("string");
		expect(text).toContain("7월 리포트");
	});

	it("falls back to the documentId when the document part has no title", () => {
		const text = messageToPromptText(
			makeMessage({
				type: "document",
				parts: [{ type: "document", documentId: "doc-9" }],
			}),
		);
		expect(text).toContain("doc-9");
	});

	it("joins mixed text and document parts of a rich message in order", () => {
		const text = messageToPromptText(
			makeMessage({
				type: "rich",
				parts: [
					{ type: "text", text: "결과입니다." },
					{ type: "document", documentId: "doc-1", title: "리포트" },
				],
			}),
		);
		expect(text.indexOf("결과입니다.")).toBeLessThan(text.indexOf("리포트"));
	});

	it("returns a string for malformed or empty content instead of undefined", () => {
		expect(messageToPromptText(makeMessage({ type: "text", parts: [] }))).toBe(
			"",
		);
		expect(
			messageToPromptText(makeMessage({ type: "rich", parts: [null, 42] })),
		).toBe("");
		expect(
			messageToPromptText({ content: undefined } as unknown as MessageObject),
		).toBe("");
	});
});
