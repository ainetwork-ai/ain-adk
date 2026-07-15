/** Execution history of scheduled jobs (workflow cron runs, document slot refreshes). */

export type ScheduleJobType = "WORKFLOW" | "SLOT_REFRESH";
export type ScheduleTrigger = "cron" | "once" | "catchup" | "manual";
export type ScheduleRunStatus =
	| "running"
	| "success"
	| "failed"
	| "skipped_overlap";

export interface ScheduleRunSlotResult {
	slotId: string;
	status: "success" | "failed" | "skipped_overlap";
	/** Total attempts including retries. */
	attempts: number;
	error?: string;
}

export interface ScheduleRun {
	runId: string;
	jobType: ScheduleJobType;
	/** WORKFLOW: workflowId, SLOT_REFRESH: documentId. */
	jobKey: string;
	trigger: ScheduleTrigger;
	/** When the run was originally scheduled to fire (epoch ms). */
	scheduledFor: number;
	startedAt: number;
	finishedAt?: number;
	status: ScheduleRunStatus;
	/** Total attempts including retries (0 while running). */
	attempts: number;
	/** Last error message when failed. */
	error?: string;
	/** Per-slot outcomes (SLOT_REFRESH only). */
	slotResults?: ScheduleRunSlotResult[];
}

export interface ScheduleRunFilter {
	jobType?: ScheduleJobType;
	jobKey?: string;
	status?: ScheduleRunStatus;
}
