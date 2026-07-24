import type { WorkflowDefinition } from "@/types/memory";
import {
	DOCUMENT_CONTEXT_TOKEN,
	injectDocumentContext,
} from "@/utils/workflow-document-context";

const baseDefinition = (prompts: string[]): WorkflowDefinition => ({
	tasks: prompts.map((prompt, i) => ({
		taskId: `t${i}`,
		title: `task ${i}`,
		prompt,
	})),
	response: {
		blocks: [
			{ blockId: "b1", type: "text", prompt: "요약", sourceTaskIds: ["t0"] },
		],
	},
});

describe("injectDocumentContext", () => {
	it("substitutes {{document}} in every task prompt that references it", () => {
		const definition = baseDefinition([
			`다음 문서를 분석: ${DOCUMENT_CONTEXT_TOKEN}`,
			"토큰 없는 태스크",
			`재참조: ${DOCUMENT_CONTEXT_TOKEN} / ${DOCUMENT_CONTEXT_TOKEN}`,
		]);
		const result = injectDocumentContext(definition, "로그북 본문");
		expect(result.tasks[0].prompt).toBe("다음 문서를 분석: 로그북 본문");
		expect(result.tasks[1].prompt).toBe("토큰 없는 태스크");
		expect(result.tasks[2].prompt).toBe("재참조: 로그북 본문 / 로그북 본문");
	});

	it("appends document content to the first task when no task references the token", () => {
		const definition = baseDefinition(["분석해줘", "정리해줘"]);
		const result = injectDocumentContext(definition, "로그북 본문");
		expect(result.tasks[0].prompt).toBe("분석해줘\n\n[문서 내용]\n로그북 본문");
		expect(result.tasks[1].prompt).toBe("정리해줘");
	});

	it("does not mutate the original definition", () => {
		const definition = baseDefinition([`${DOCUMENT_CONTEXT_TOKEN}`]);
		injectDocumentContext(definition, "본문");
		expect(definition.tasks[0].prompt).toBe(DOCUMENT_CONTEXT_TOKEN);
	});
});
