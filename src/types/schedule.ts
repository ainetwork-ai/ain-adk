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

/** Why a slot on the document was left out of a run's target set. */
export type ScheduleRunExclusionReason =
	/** No binding, so the slot is not auto-refreshable at all. */
	| "no_binding"
	/** A bound slot dropped by an explicit `autoRefresh.slotIds` allowlist. */
	| "not_in_slot_ids"
	/** Already ledgered in `doneSlotIds` by an earlier run or a manual fill. */
	| "already_done";

export interface ScheduleRunExclusion {
	slotId: string;
	reason: ScheduleRunExclusionReason;
}

/**
 * How a SLOT_REFRESH run derived its target slots, written before the slot
 * jobs are submitted.
 *
 * `slotResults` alone cannot tell "the slot ran and failed" apart from "the
 * slot was never a target": a run that silently covers 3 of a document's 6
 * slots is indistinguishable from a clean 3-slot success. Recording the
 * derivation makes that auditable after the fact, and — because it is
 * persisted up front — it survives a run interrupted by a restart.
 */
export interface ScheduleRunTargeting {
	/** Every slot on the document at run time, in document order. */
	documentSlotIds: string[];
	/** The explicit allowlist from `autoRefresh.slotIds`, when one was set. */
	requestedSlotIds?: string[];
	/** Slots submitted to the JobRunner — 1:1 with `slotResults`. */
	targetSlotIds: string[];
	/** Slots on the document this run did not touch, and why. */
	excluded: ScheduleRunExclusion[];
}

/** Why a run finished successfully without submitting a single slot job. */
export type ScheduleRunNoopReason =
	| "auto_refresh_inactive"
	| "auto_refresh_completed"
	| "no_pending_slots";

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
	/** How the target slot set was derived (SLOT_REFRESH only). */
	targeting?: ScheduleRunTargeting;
	/** Set when the run succeeded without doing any work. */
	noopReason?: ScheduleRunNoopReason;
}

/**
 * Who initiated a document slot fill. Carried into the fill's start log so a
 * fill appearing at an unexpected time is traceable to its origin: a
 * scheduled auto-refresh run (with the run's trigger and planned fire time)
 * vs. a manual fill API call (with the requesting user).
 */
export type SlotFillInitiator =
	| {
			type: "schedule";
			trigger: ScheduleTrigger;
			/** When the run was originally scheduled to fire (epoch ms). */
			scheduledFor: number;
			/** The schedule run this fill belongs to. */
			runId: string;
	  }
	| { type: "manual"; userId?: string };

export interface ScheduleRunFilter {
	jobType?: ScheduleJobType;
	jobKey?: string;
	status?: ScheduleRunStatus;
}
