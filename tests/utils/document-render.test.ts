import { renderDocument } from "@/utils/document-render";
import type { Document } from "@/types/document";

function makeDoc(partial: Partial<Document>): Document {
	return {
		documentId: "doc-1",
		userId: "user-1",
		title: "Doc",
		format: "MARKDOWN" as Document["format"],
		content: "",
		source: "MANUAL" as Document["source"],
		version: 1,
		createdAt: "t0",
		updatedAt: "t0",
		...partial,
	};
}

describe("renderDocument", () => {
	it("substitutes a resolved slot token with its fragment content", () => {
		const doc = makeDoc({
			content: "## 매출\n{{slot:revenue}}\n끝",
			slots: [
				{
					slotId: "revenue",
					status: "resolved",
					fragment: {
						content: "| 월 | 매출 |\n|---|---|\n| 6 | 100 |",
						source: { type: "WORKFLOW", workflowId: "wf-1" },
						resolvedAt: "t1",
					},
				},
			],
		});

		expect(renderDocument(doc)).toBe(
			"## 매출\n| 월 | 매출 |\n|---|---|\n| 6 | 100 |\n끝",
		);
	});

	it("renders a placeholder for unresolved slots and leaves unknown tokens intact", () => {
		const doc = makeDoc({
			content: "{{slot:revenue}} / {{slot:unknown}}",
			slots: [{ slotId: "revenue", status: "empty", label: "매출" }],
		});

		const out = renderDocument(doc);
		expect(out).toContain("매출 (조회 전)");
		expect(out).toContain("{{slot:unknown}}");
	});
});
