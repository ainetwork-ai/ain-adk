import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import type { MemoryModule } from "@/modules/memory/memory.module.js";
import type { Document, DocumentAutoRefresh } from "@/types/document.js";
import type { UserWorkflow } from "@/types/memory.js";
import type {
	ScheduleRunSlotResult,
	ScheduleTrigger,
} from "@/types/schedule.js";
import { loggers } from "@/utils/logger.js";
import type { JobRunnerService } from "./job-runner.service.js";
import type { UserWorkflowService } from "./user-workflow.service.js";
import type { WorkflowExecutionService } from "./workflow-execution.service.js";

/**
 * Cron-based scheduler for user workflows plus one-shot document auto
 * refreshes. Triggering (node-cron / minute tick) is separated from
 * execution: every run goes through the JobRunner, which owns concurrency,
 * retries and the rate-limit cooldown. This service owns run history and
 * schedule state (nextRunAt, autoRefresh bookkeeping).
 */
export class SchedulerService {
	private userWorkflowService: UserWorkflowService;
	private workflowExecutionService: WorkflowExecutionService;
	private jobRunner: JobRunnerService;
	private memoryModule: MemoryModule;
	private tasks: Map<string, ScheduledTask> = new Map();
	private pendingAutoRefresh: Map<string, number> = new Map();
	private tickTimer?: ReturnType<typeof setInterval>;
	private static readonly TICK_INTERVAL_MS = 60_000;
	private static readonly MAX_CONSECUTIVE_FAILURES = 3;
	/** Consecutive failed cron runs per workflowId; reset on success. */
	private consecutiveFailures: Map<string, number> = new Map();

	constructor(
		userWorkflowService: UserWorkflowService,
		workflowExecutionService: WorkflowExecutionService,
		jobRunner: JobRunnerService,
		memoryModule: MemoryModule,
	) {
		this.userWorkflowService = userWorkflowService;
		this.workflowExecutionService = workflowExecutionService;
		this.jobRunner = jobRunner;
		this.memoryModule = memoryModule;
	}

	async start(): Promise<void> {
		const scheduleRunMemory = this.memoryModule.getScheduleRunMemory();
		if (scheduleRunMemory) {
			const interrupted = await scheduleRunMemory.failInterruptedRuns();
			if (interrupted > 0) {
				loggers.agent.warn(
					`Marked ${interrupted} interrupted schedule run(s) as failed`,
				);
			}
		}

		const activeWorkflows =
			await this.userWorkflowService.listActiveScheduledWorkflows();
		loggers.agent.info(
			`Scheduler starting with ${activeWorkflows.length} active workflow(s)`,
		);
		for (const workflow of activeWorkflows) {
			// Catch-up BEFORE scheduleWorkflow refreshes nextRunAt.
			const overdue =
				workflow.nextRunAt !== undefined && workflow.nextRunAt <= Date.now();
			await this.scheduleWorkflow(workflow);
			if (overdue) {
				void this.runWorkflowJob(
					workflow.workflowId,
					"catchup",
					workflow.nextRunAt ?? Date.now(),
				);
			}
		}

		await this.loadAutoRefreshDocuments();
		this.startTick();
		this.tick(); // 부팅 즉시 1회 — runAt이 이미 지난 문서의 catch-up
	}

	async stop(): Promise<void> {
		loggers.agent.info(
			`Scheduler stopping, clearing ${this.tasks.size} task(s)`,
		);
		for (const [workflowId, task] of this.tasks) {
			await task.stop();
			loggers.agent.debug(`Stopped scheduled task: ${workflowId}`);
		}
		this.tasks.clear();
		if (this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = undefined;
		}
		await this.jobRunner.drain();
	}

	async scheduleWorkflow(workflow: UserWorkflow): Promise<void> {
		if (!workflow.schedule) {
			return;
		}
		if (this.tasks.has(workflow.workflowId)) {
			await this.unscheduleWorkflow(workflow.workflowId);
		}
		if (!cron.validate(workflow.schedule)) {
			loggers.agent.error(
				`Invalid cron expression for workflow ${workflow.workflowId}: ${workflow.schedule}`,
			);
			return;
		}

		const task = cron.schedule(
			workflow.schedule,
			async (_context) => {
				loggers.agent.info(
					`Cron triggered workflow: ${workflow.title} (${workflow.workflowId})`,
				);
				await this.runWorkflowJob(workflow.workflowId, "cron", Date.now());
			},
			{
				timezone: workflow.timezone,
				name: workflow.workflowId,
			},
		);
		this.tasks.set(workflow.workflowId, task);

		const nextRun = task.getNextRun();
		await this.userWorkflowService.updateWorkflow(workflow.workflowId, {
			userId: workflow.userId,
			nextRunAt: nextRun ? nextRun.getTime() : undefined,
		});
		loggers.agent.info(
			`Scheduled workflow: ${workflow.title} (${workflow.workflowId}) with cron "${workflow.schedule}"${workflow.timezone ? ` [${workflow.timezone}]` : ""}`,
		);
	}

	async unscheduleWorkflow(workflowId: string): Promise<void> {
		const task = this.tasks.get(workflowId);
		if (task) {
			await task.stop();
			this.tasks.delete(workflowId);
			loggers.agent.debug(`Unscheduled workflow: ${workflowId}`);
		}
		this.consecutiveFailures.delete(workflowId);
	}

	async rescheduleWorkflow(workflow: UserWorkflow): Promise<void> {
		await this.unscheduleWorkflow(workflow.workflowId);
		if (workflow.active && workflow.schedule) {
			await this.scheduleWorkflow(workflow);
		}
	}

	/**
	 * Executes one scheduled workflow run through the JobRunner and records
	 * it in schedule_runs. Public for tests and manual triggering.
	 *
	 * Never rejects: execution errors are absorbed by the JobRunner, and
	 * bookkeeping (memory) errors are caught and logged here so that
	 * fire-and-forget callers (boot catch-up) cannot crash the process
	 * with an unhandled rejection.
	 */
	async runWorkflowJob(
		workflowId: string,
		trigger: ScheduleTrigger,
		scheduledFor: number,
	): Promise<void> {
		try {
			const scheduleRunMemory = this.memoryModule.getScheduleRunMemory();
			const runId = randomUUID();
			const startedAt = Date.now();
			await scheduleRunMemory?.createScheduleRun({
				runId,
				jobType: "WORKFLOW",
				jobKey: workflowId,
				trigger,
				scheduledFor,
				startedAt,
				status: "running",
				attempts: 0,
			});

			const workflow = await this.userWorkflowService.getWorkflow(workflowId);
			if (!workflow) {
				// Deleted since scheduling: stop repeating a doomed job.
				await this.unscheduleWorkflow(workflowId);
				await scheduleRunMemory?.updateScheduleRun(runId, {
					status: "failed",
					finishedAt: Date.now(),
					attempts: 1,
					error: "Workflow not found; unscheduled",
				});
				return;
			}

			const outcome = await this.jobRunner.submit({
				jobKey: workflowId,
				execute: async () => {
					await this.workflowExecutionService.executeWorkflow(workflowId);
				},
			});

			// Spec §8: a workflow that fails deterministically (broken definition,
			// etc.) would otherwise fail every cron period forever. Tracked
			// in-memory only (deliberate, non-destructive): a process restart
			// re-arms the schedule for one more attempt cycle rather than
			// permanently stranding a workflow whose definition was fixed but
			// whose persisted counter was never cleared.
			if (outcome.status === "failed") {
				const failures = (this.consecutiveFailures.get(workflowId) ?? 0) + 1;
				this.consecutiveFailures.set(workflowId, failures);
				if (failures >= SchedulerService.MAX_CONSECUTIVE_FAILURES) {
					loggers.agent.warn(
						`Auto-unscheduled workflow ${workflowId} after ${failures} consecutive failures`,
					);
					await this.unscheduleWorkflow(workflowId);
				}
			} else if (outcome.status === "success") {
				this.consecutiveFailures.delete(workflowId);
			}

			await scheduleRunMemory?.updateScheduleRun(runId, {
				status: outcome.status,
				finishedAt: Date.now(),
				attempts: outcome.attempts,
				error: outcome.status === "failed" ? outcome.error : undefined,
			});

			const nextRun = this.tasks.get(workflowId)?.getNextRun();
			await this.userWorkflowService.updateWorkflow(workflowId, {
				userId: workflow.userId,
				lastRunAt: startedAt,
				nextRunAt: nextRun ? nextRun.getTime() : undefined,
			});
		} catch (error) {
			loggers.agent.error("Scheduled run bookkeeping failed", {
				workflowId,
				error,
			});
		}
	}

	/** Reflects a created/updated document in the pending auto-refresh list. */
	notifyDocumentAutoRefresh(document: Document): void {
		const autoRefresh = document.autoRefresh;
		if (autoRefresh?.active && !autoRefresh.completedAt) {
			this.pendingAutoRefresh.set(document.documentId, autoRefresh.runAt);
		} else {
			this.pendingAutoRefresh.delete(document.documentId);
		}
	}

	/** Drops a (deleted) document from the pending list. */
	removeDocumentAutoRefresh(documentId: string): void {
		this.pendingAutoRefresh.delete(documentId);
	}

	/** Exposed for tests: starts the minute tick without full start(). */
	startTickForTest(): void {
		this.startTick();
	}

	private startTick(): void {
		if (this.tickTimer) return;
		this.tickTimer = setInterval(
			() => this.tick(),
			SchedulerService.TICK_INTERVAL_MS,
		);
		this.tickTimer.unref?.();
	}

	private async loadAutoRefreshDocuments(): Promise<void> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		if (!documentMemory?.listAutoRefreshPendingDocuments) {
			return;
		}
		const documents = await documentMemory.listAutoRefreshPendingDocuments();
		for (const document of documents) {
			this.notifyDocumentAutoRefresh(document);
		}
		loggers.agent.info(
			`Scheduler loaded ${this.pendingAutoRefresh.size} pending auto-refresh document(s)`,
		);
	}

	private tick(): void {
		const now = Date.now();
		for (const [documentId, runAt] of this.pendingAutoRefresh) {
			if (runAt <= now) {
				this.pendingAutoRefresh.delete(documentId);
				const trigger: ScheduleTrigger =
					runAt <= now - SchedulerService.TICK_INTERVAL_MS ? "catchup" : "once";
				void this.runAutoRefreshJob(documentId, trigger, runAt);
			}
		}
	}

	/**
	 * Expands a document auto refresh into per-slot jobs (the JobRunner
	 * throttles them), accumulates doneSlotIds, and completes the refresh
	 * only when every target slot succeeded. Failed slots stay pending so
	 * the next boot catch-up retries ONLY them.
	 *
	 * Never rejects: slot execution failures are absorbed by the JobRunner
	 * (submit() never rejects), and bookkeeping (memory) errors are caught
	 * and logged here so that fire-and-forget callers (tick) cannot crash
	 * the process with an unhandled rejection.
	 */
	async runAutoRefreshJob(
		documentId: string,
		trigger: ScheduleTrigger,
		scheduledFor: number,
	): Promise<void> {
		try {
			const documentMemory = this.memoryModule.getDocumentMemory();
			const scheduleRunMemory = this.memoryModule.getScheduleRunMemory();
			if (!documentMemory) return;

			const runId = randomUUID();
			await scheduleRunMemory?.createScheduleRun({
				runId,
				jobType: "SLOT_REFRESH",
				jobKey: documentId,
				trigger,
				scheduledFor,
				startedAt: Date.now(),
				status: "running",
				attempts: 0,
			});

			const document = await documentMemory.getDocument(documentId);
			if (!document) {
				await scheduleRunMemory?.updateScheduleRun(runId, {
					status: "failed",
					finishedAt: Date.now(),
					attempts: 1,
					error: "Document not found",
				});
				return;
			}
			const autoRefresh = document.autoRefresh;
			if (!autoRefresh?.active || autoRefresh.completedAt) {
				await scheduleRunMemory?.updateScheduleRun(runId, {
					status: "success",
					finishedAt: Date.now(),
					attempts: 0,
				});
				return;
			}

			const done = new Set(autoRefresh.doneSlotIds ?? []);
			const targetIds = this.getAutoRefreshTargetSlotIds(
				document,
				autoRefresh,
			).filter((slotId) => !done.has(slotId));

			if (targetIds.length === 0) {
				await documentMemory.completeAutoRefresh?.(documentId, Date.now());
				await scheduleRunMemory?.updateScheduleRun(runId, {
					status: "success",
					finishedAt: Date.now(),
					attempts: 0,
				});
				return;
			}

			const slotResults: ScheduleRunSlotResult[] = [];
			let doneMarkingFailed = false;
			await Promise.all(
				targetIds.map(async (slotId) => {
					const outcome = await this.jobRunner.submit({
						jobKey: `${documentId}:${slotId}`,
						execute: async () => {
							await this.workflowExecutionService.fillDocumentSlot(
								documentId,
								slotId,
							);
						},
					});
					if (outcome.status === "success") {
						// A rejection here must not fail-fast the Promise.all and
						// skip the aggregate run bookkeeping below. The fill itself
						// succeeded, so the slot still counts as success; only
						// completion is withheld so the next catch-up redoes the
						// (idempotent) done-marking.
						try {
							// The fill resolving is not proof the slot resolved: a
							// "no content produced" fill persists status:"failed" on
							// the slot and returns without throwing. Re-read the
							// document and require the fresh persisted status to be
							// "resolved" before ledgering the slot as done —
							// otherwise record it as a failed slot so the run
							// aggregates to failed, completion is withheld, and the
							// boot catch-up retries it.
							const fresh = await documentMemory.getDocument(documentId);
							const freshSlot = fresh?.slots?.find((s) => s.slotId === slotId);
							if (freshSlot?.status !== "resolved") {
								slotResults.push({
									slotId,
									status: "failed",
									attempts: outcome.attempts,
									error: freshSlot?.error ?? "No content produced",
								});
								return;
							}
							await documentMemory.markAutoRefreshSlotDone?.(
								documentId,
								slotId,
							);
						} catch (error) {
							doneMarkingFailed = true;
							loggers.agent.error("Auto-refresh slot bookkeeping failed", {
								documentId,
								slotId,
								error,
							});
						}
					} else if (outcome.status === "failed") {
						// fillDocumentSlotStream throws for several pre-execution
						// cases (document/slot/binding/workflow/definition gone)
						// BEFORE ever writing status:"failed" to the slot itself —
						// only post-start execution errors do that. Without this,
						// the frontend badge (derived solely from slot.status)
						// stays stuck "in progress" forever. Idempotent with the
						// execution-failure path, which already sets this status.
						try {
							await documentMemory.updateDocumentSlot(documentId, slotId, {
								status: "failed",
								error: outcome.error,
							});
						} catch (error) {
							loggers.agent.error("Auto-refresh slot bookkeeping failed", {
								documentId,
								slotId,
								error,
							});
						}
					}
					slotResults.push({
						slotId,
						status: outcome.status,
						attempts: outcome.attempts,
						error: outcome.status === "failed" ? outcome.error : undefined,
					});
				}),
			);

			const failed = slotResults.filter((r) => r.status !== "success");
			if (failed.length === 0 && !doneMarkingFailed) {
				await documentMemory.completeAutoRefresh?.(documentId, Date.now());
			}
			await scheduleRunMemory?.updateScheduleRun(runId, {
				status: failed.length === 0 ? "success" : "failed",
				finishedAt: Date.now(),
				attempts: 1,
				error:
					failed.length > 0
						? `${failed.length}/${slotResults.length} slot(s) failed`
						: undefined,
				slotResults,
			});
		} catch (error) {
			loggers.agent.error("Auto-refresh run bookkeeping failed", {
				documentId,
				error,
			});
		}
	}

	/**
	 * Target slot ids for a document's auto-refresh: an explicit allowlist, or
	 * (default) every slot with a binding. Shared by {@link runAutoRefreshJob}
	 * and {@link reconcileManualSlotFill} so the two stay in sync.
	 */
	private getAutoRefreshTargetSlotIds(
		document: Document,
		autoRefresh: DocumentAutoRefresh,
	): string[] {
		const boundSlotIds = (document.slots ?? [])
			.filter((slot) => slot.binding)
			.map((slot) => slot.slotId);
		return autoRefresh.slotIds ?? boundSlotIds;
	}

	/**
	 * Reconciles a successful MANUAL slot fill into the auto-refresh ledger.
	 * If the slot is a target of a pending (active, incomplete) autoRefresh,
	 * mark it done; if that completes every target, stamp completedAt and drop
	 * the pending entry. Idempotent; never throws (bookkeeping must not fail
	 * the fill request).
	 */
	async reconcileManualSlotFill(
		documentId: string,
		slotId: string,
	): Promise<void> {
		try {
			const documentMemory = this.memoryModule.getDocumentMemory();
			if (!documentMemory) return;

			const document = await documentMemory.getDocument(documentId);
			const autoRefresh = document?.autoRefresh;
			if (!document || !autoRefresh?.active || autoRefresh.completedAt) {
				return;
			}

			const targets = this.getAutoRefreshTargetSlotIds(document, autoRefresh);
			if (!targets.includes(slotId)) return;

			// The fill call resolving is not proof the slot resolved: a "no
			// content produced" fill persists status:"failed" on the slot and
			// returns without throwing. Only a slot whose persisted status is
			// "resolved" may be ledgered as done.
			const slot = document.slots?.find((s) => s.slotId === slotId);
			if (slot?.status !== "resolved") {
				loggers.agent.debug(
					"Manual fill reconciliation skipped: slot not resolved",
					{ documentId, slotId, status: slot?.status },
				);
				return;
			}

			await documentMemory.markAutoRefreshSlotDone?.(documentId, slotId);

			const done = new Set([...(autoRefresh.doneSlotIds ?? []), slotId]);
			if (targets.every((id) => done.has(id))) {
				await documentMemory.completeAutoRefresh?.(documentId, Date.now());
				this.removeDocumentAutoRefresh(documentId);
			}
		} catch (error) {
			loggers.agent.error("Manual fill auto-refresh reconciliation failed", {
				documentId,
				slotId,
				error,
			});
		}
	}
}
