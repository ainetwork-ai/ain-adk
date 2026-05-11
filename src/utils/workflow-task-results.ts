import type { WorkflowTaskResult } from "@/types/memory";

export function serializeTaskResults(
	taskResults: WorkflowTaskResult[],
): string {
	return taskResults
		.map(
			(result) =>
				`[${result.taskId}] ${result.title}\nStatus: ${result.status}\nResult:\n${result.content || result.error || ""}`,
		)
		.join("\n\n---\n\n");
}
