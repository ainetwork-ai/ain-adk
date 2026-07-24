import type { WorkflowTask, WorkflowTaskResult } from "@/types/memory";

/** Display label for a task: its title when set, otherwise the taskId. */
export function workflowTaskLabel(
	task: Pick<WorkflowTask, "taskId" | "title">,
): string {
	return task.title?.trim() || task.taskId;
}

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
