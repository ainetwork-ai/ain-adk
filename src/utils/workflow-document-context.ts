import type { WorkflowDefinition } from "@/types/memory.js";

export const DOCUMENT_CONTEXT_TOKEN = "{{document}}";

/**
 * Injects a document's rendered content into a workflow definition.
 *
 * Task prompts referencing {{document}} get it substituted; if no task
 * references the token, the content is appended to the FIRST task's prompt
 * so the document context is always present regardless of how the workflow
 * was authored. Returns a new definition (input is not mutated).
 */
export function injectDocumentContext(
	definition: WorkflowDefinition,
	renderedContent: string,
): WorkflowDefinition {
	const hasToken = definition.tasks.some((task) =>
		task.prompt.includes(DOCUMENT_CONTEXT_TOKEN),
	);
	const tasks = definition.tasks.map((task, index) => {
		if (hasToken) {
			if (!task.prompt.includes(DOCUMENT_CONTEXT_TOKEN)) {
				return task;
			}
			return {
				...task,
				prompt: task.prompt.replaceAll(DOCUMENT_CONTEXT_TOKEN, renderedContent),
			};
		}
		if (index === 0) {
			return {
				...task,
				prompt: `${task.prompt}\n\n[문서 내용]\n${renderedContent}`,
			};
		}
		return task;
	});
	return { ...definition, tasks };
}
