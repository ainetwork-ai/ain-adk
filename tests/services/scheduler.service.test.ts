import { JobRunnerService } from "@/services/job-runner.service";
import { SchedulerService } from "@/services/scheduler.service";
import type { UserWorkflow, WorkflowDefinition } from "@/types/memory";
import { loggers } from "@/utils/logger";

const minimalDefinition: WorkflowDefinition = {
	tasks: [{ taskId: "t1", title: "분석", prompt: "분석해줘" }],
	response: {
		blocks: [
			{ blockId: "b1", type: "text", prompt: "요약", sourceTaskIds: ["t1"] },
		],
	},
};

function makeWorkflow(overrides: Partial<UserWorkflow> = {}): UserWorkflow {
	return {
		workflowId: "wf-1",
		userId: "user-1",
		title: "테스트 워크플로우",
		active: true,
		content: "",
		definition: minimalDefinition,
		schedule: "0 9 * * *",
		...overrides,
	};
}

function makeMocks() {
	const userWorkflowService = {
		listActiveScheduledWorkflows: jest.fn().mockResolvedValue([]),
		getWorkflow: jest.fn(),
		updateWorkflow: jest.fn().mockResolvedValue(undefined),
	};
	const workflowExecutionService = {
		executeWorkflow: jest.fn().mockResolvedValue({ threadId: "t-1" }),
		fillDocumentSlot: jest.fn().mockResolvedValue({}),
	};
	const scheduleRunMemory = {
		createScheduleRun: jest.fn().mockResolvedValue(undefined),
		updateScheduleRun: jest.fn().mockResolvedValue(undefined),
		listScheduleRuns: jest.fn().mockResolvedValue([]),
		failInterruptedRuns: jest.fn().mockResolvedValue(0),
	};
	const documentMemory = {
		getDocument: jest.fn(),
		listAutoRefreshPendingDocuments: jest.fn().mockResolvedValue([]),
		markAutoRefreshSlotDone: jest.fn().mockResolvedValue(undefined),
		completeAutoRefresh: jest.fn().mockResolvedValue(undefined),
		updateDocumentSlot: jest.fn().mockResolvedValue(undefined),
	};
	const memoryModule = {
		getScheduleRunMemory: () => scheduleRunMemory,
		getDocumentMemory: () => documentMemory,
	};
	const jobRunner = new JobRunnerService({
		maxConcurrent: 2,
		retryDelaysMs: [],
	});
	const scheduler = new SchedulerService(
		// biome-ignore lint/suspicious/noExplicitAny: test doubles
		userWorkflowService as any,
		// biome-ignore lint/suspicious/noExplicitAny: test doubles
		workflowExecutionService as any,
		jobRunner,
		// biome-ignore lint/suspicious/noExplicitAny: test doubles
		memoryModule as any,
	);
	return {
		scheduler,
		userWorkflowService,
		workflowExecutionService,
		scheduleRunMemory,
		documentMemory,
	};
}

describe("SchedulerService — workflow jobs", () => {
	afterEach(async () => {
		jest.restoreAllMocks();
	});

	it("records a success run and updates lastRunAt", async () => {
		const m = makeMocks();
		m.userWorkflowService.getWorkflow.mockResolvedValue(makeWorkflow());
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());

		expect(m.workflowExecutionService.executeWorkflow).toHaveBeenCalledWith("wf-1");
		expect(m.scheduleRunMemory.createScheduleRun).toHaveBeenCalledWith(
			expect.objectContaining({ jobType: "WORKFLOW", jobKey: "wf-1", status: "running" }),
		);
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "success", attempts: 1 }),
		);
		expect(m.userWorkflowService.updateWorkflow).toHaveBeenCalledWith(
			"wf-1",
			expect.objectContaining({ lastRunAt: expect.any(Number) }),
		);
	});

	it("records a failed run when execution rejects", async () => {
		const m = makeMocks();
		m.userWorkflowService.getWorkflow.mockResolvedValue(makeWorkflow());
		m.workflowExecutionService.executeWorkflow.mockRejectedValue(
			Object.assign(new Error("definition broken"), { status: 400 }),
		);
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed", error: "definition broken" }),
		);
	});

	it("unschedules and fails the run when the workflow is gone", async () => {
		const m = makeMocks();
		m.userWorkflowService.getWorkflow.mockResolvedValue(undefined);
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());
		expect(m.workflowExecutionService.executeWorkflow).not.toHaveBeenCalled();
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("resolves and logs instead of rejecting when run bookkeeping fails", async () => {
		const m = makeMocks();
		const errorSpy = jest
			.spyOn(loggers.agent, "error")
			.mockImplementation(() => loggers.agent);
		m.userWorkflowService.getWorkflow.mockResolvedValue(makeWorkflow());
		m.scheduleRunMemory.createScheduleRun.mockRejectedValueOnce(
			new Error("mongo down"),
		);

		// Must not reject: start() fires this call as void (fire-and-forget),
		// so a rejection here would become an unhandled rejection at boot.
		await expect(
			m.scheduler.runWorkflowJob("wf-1", "catchup", Date.now()),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			"Scheduled run bookkeeping failed",
			expect.objectContaining({ workflowId: "wf-1" }),
		);
	});

	it("start() marks interrupted runs and queues catch-up for overdue workflows", async () => {
		const m = makeMocks();
		const overdue = makeWorkflow({ nextRunAt: Date.now() - 60_000 });
		m.userWorkflowService.listActiveScheduledWorkflows.mockResolvedValue([overdue]);
		m.userWorkflowService.getWorkflow.mockResolvedValue(overdue);
		await m.scheduler.start();
		// runWorkflowJob은 void로 발사되므로 마이크로태스크 플러시
		await new Promise((r) => setTimeout(r, 10));
		expect(m.scheduleRunMemory.failInterruptedRuns).toHaveBeenCalled();
		expect(m.scheduleRunMemory.createScheduleRun).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: "catchup", jobKey: "wf-1" }),
		);
		await m.scheduler.stop();
	});
});

describe("SchedulerService — repeated-failure auto-unschedule", () => {
	afterEach(async () => {
		jest.restoreAllMocks();
	});

	it("auto-unschedules a workflow after 3 consecutive failures, not before", async () => {
		const m = makeMocks();
		m.userWorkflowService.getWorkflow.mockResolvedValue(makeWorkflow());
		m.workflowExecutionService.executeWorkflow.mockRejectedValue(
			Object.assign(new Error("definition broken"), { status: 400 }),
		);
		const unscheduleSpy = jest.spyOn(m.scheduler, "unscheduleWorkflow");

		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());
		expect(unscheduleSpy).not.toHaveBeenCalled();

		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());
		expect(unscheduleSpy).not.toHaveBeenCalled();

		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());
		expect(unscheduleSpy).toHaveBeenCalledTimes(1);
		expect(unscheduleSpy).toHaveBeenCalledWith("wf-1");
	});

	it("a success in between resets the consecutive-failure counter", async () => {
		const m = makeMocks();
		m.userWorkflowService.getWorkflow.mockResolvedValue(makeWorkflow());
		const unscheduleSpy = jest.spyOn(m.scheduler, "unscheduleWorkflow");
		const failure = () =>
			Promise.reject(Object.assign(new Error("boom"), { status: 400 }));

		m.workflowExecutionService.executeWorkflow.mockImplementationOnce(failure);
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());

		m.workflowExecutionService.executeWorkflow.mockResolvedValueOnce({
			threadId: "t-1",
		});
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());

		m.workflowExecutionService.executeWorkflow.mockImplementationOnce(failure);
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());

		m.workflowExecutionService.executeWorkflow.mockImplementationOnce(failure);
		await m.scheduler.runWorkflowJob("wf-1", "cron", Date.now());

		// Only 2 consecutive failures since the success reset — not yet at 3.
		expect(unscheduleSpy).not.toHaveBeenCalled();
	});
});

describe("SchedulerService — document auto refresh", () => {
	afterEach(async () => {
		jest.restoreAllMocks();
	});

	// Slots default to status "resolved": done-marking re-reads the document
	// after each successful fill and requires the persisted status to be
	// "resolved" (a "no content produced" fill resolves without throwing but
	// persists "failed"). The single getDocument mock serves both the initial
	// read and the post-fill re-read, so the fixture models the post-fill state.
	function makeLogbookDocument(overrides: Record<string, unknown> = {}) {
		return {
			documentId: "doc-1",
			userId: "user-1",
			title: "로그북",
			format: "MARKDOWN",
			content: "{{slot:s1}} {{slot:s2}}",
			slots: [
				{ slotId: "s1", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-a" } },
				{ slotId: "s2", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-b" } },
				{ slotId: "no-binding", status: "empty" },
			],
			source: "MANUAL",
			version: 1,
			createdAt: "",
			updatedAt: "",
			autoRefresh: { runAt: Date.now() - 1000, active: true },
			...overrides,
		};
	}

	it("fills every bound slot, marks done, completes on full success", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		await m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now());

		expect(m.workflowExecutionService.fillDocumentSlot).toHaveBeenCalledTimes(2);
		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith("doc-1", "s2");
		expect(m.documentMemory.completeAutoRefresh).toHaveBeenCalledWith(
			"doc-1",
			expect.any(Number),
		);
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				status: "success",
				slotResults: expect.arrayContaining([
					expect.objectContaining({ slotId: "s1", status: "success" }),
				]),
			}),
		);
	});

	it("on partial failure: marks only successes done, does NOT complete", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		m.workflowExecutionService.fillDocumentSlot.mockImplementation(
			async (_docId: string, slotId: string) => {
				if (slotId === "s2")
					throw Object.assign(new Error("boom"), { status: 400 });
				return {};
			},
		);
		await m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now());

		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalledWith("doc-1", "s2");
		expect(m.documentMemory.completeAutoRefresh).not.toHaveBeenCalled();
		expect(m.documentMemory.updateDocumentSlot).toHaveBeenCalledWith(
			"doc-1",
			"s2",
			expect.objectContaining({ status: "failed" }),
		);
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("marks a pre-execution slot failure (document/slot/binding/workflow gone) as failed", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		m.workflowExecutionService.fillDocumentSlot.mockImplementation(
			async (_docId: string, slotId: string) => {
				if (slotId === "s2")
					throw new Error(`No workflow bound to slot doc-1/${slotId}`);
				return {};
			},
		);
		await m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now());

		expect(m.documentMemory.updateDocumentSlot).toHaveBeenCalledWith(
			"doc-1",
			"s2",
			expect.objectContaining({
				status: "failed",
				error: expect.stringContaining("No workflow bound"),
			}),
		);
	});

	it("logs (does not throw) when updateDocumentSlot rejects on slot failure", async () => {
		const m = makeMocks();
		const errorSpy = jest
			.spyOn(loggers.agent, "error")
			.mockImplementation(() => loggers.agent);
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		m.documentMemory.updateDocumentSlot.mockRejectedValue(new Error("mongo down"));
		m.workflowExecutionService.fillDocumentSlot.mockImplementation(
			async (_docId: string, slotId: string) => {
				if (slotId === "s2")
					throw Object.assign(new Error("boom"), { status: 400 });
				return {};
			},
		);

		await expect(
			m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now()),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			"Auto-refresh slot bookkeeping failed",
			expect.objectContaining({ documentId: "doc-1", slotId: "s2" }),
		);
	});

	it("skips already-done slots (doneSlotIds subtraction)", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				autoRefresh: { runAt: 0, active: true, doneSlotIds: ["s1"] },
			}),
		);
		await m.scheduler.runAutoRefreshJob("doc-1", "catchup", Date.now());
		expect(m.workflowExecutionService.fillDocumentSlot).toHaveBeenCalledTimes(1);
		expect(m.workflowExecutionService.fillDocumentSlot).toHaveBeenCalledWith("doc-1", "s2");
	});

	it("treats a resolving fill whose slot persisted 'failed' as a failed slot (no content produced)", async () => {
		const m = makeMocks();
		// fillDocumentSlot resolves for BOTH slots, but s2's persisted status is
		// "failed" — the fill produced no content, wrote status:"failed", and
		// returned without throwing.
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				slots: [
					{ slotId: "s1", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-a" } },
					{ slotId: "s2", status: "failed", error: "No content produced", binding: { type: "WORKFLOW", workflowId: "wf-b" } },
				],
			}),
		);
		await m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now());

		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalledWith("doc-1", "s2");
		expect(m.documentMemory.completeAutoRefresh).not.toHaveBeenCalled();
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				status: "failed",
				slotResults: expect.arrayContaining([
					expect.objectContaining({ slotId: "s1", status: "success" }),
					expect.objectContaining({
						slotId: "s2",
						status: "failed",
						error: "No content produced",
					}),
				]),
			}),
		);
	});

	it("records failed run when the document is gone", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(undefined);
		await m.scheduler.runAutoRefreshJob("doc-gone", "once", Date.now());
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed", error: "Document not found" }),
		);
	});

	it("notifyDocumentAutoRefresh adds a pending entry and tick dispatches due jobs", async () => {
		jest.useFakeTimers();
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		// biome-ignore lint/suspicious/noExplicitAny: test double
		m.scheduler.notifyDocumentAutoRefresh(makeLogbookDocument() as any);
		m.scheduler.startTickForTest();
		await jest.advanceTimersByTimeAsync(60_000);
		jest.useRealTimers();
		await new Promise((r) => setTimeout(r, 10));
		expect(m.workflowExecutionService.fillDocumentSlot).toHaveBeenCalled();
		await m.scheduler.stop();
	});

	it("notifyDocumentAutoRefresh with inactive autoRefresh removes the pending entry", async () => {
		jest.useFakeTimers();
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		// biome-ignore lint/suspicious/noExplicitAny: test double
		m.scheduler.notifyDocumentAutoRefresh(makeLogbookDocument() as any);
		m.scheduler.notifyDocumentAutoRefresh(
			makeLogbookDocument({
				autoRefresh: { runAt: Date.now() - 1000, active: false },
				// biome-ignore lint/suspicious/noExplicitAny: test double
			}) as any,
		);
		m.scheduler.startTickForTest();
		await jest.advanceTimersByTimeAsync(60_000);
		jest.useRealTimers();
		await new Promise((r) => setTimeout(r, 10));
		expect(m.workflowExecutionService.fillDocumentSlot).not.toHaveBeenCalled();
		expect(m.scheduleRunMemory.createScheduleRun).not.toHaveBeenCalled();
		await m.scheduler.stop();
	});

	it("removeDocumentAutoRefresh drops a pending entry so tick dispatches nothing", async () => {
		jest.useFakeTimers();
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		// biome-ignore lint/suspicious/noExplicitAny: test double
		m.scheduler.notifyDocumentAutoRefresh(makeLogbookDocument() as any);
		m.scheduler.removeDocumentAutoRefresh("doc-1");
		m.scheduler.startTickForTest();
		await jest.advanceTimersByTimeAsync(60_000);
		jest.useRealTimers();
		await new Promise((r) => setTimeout(r, 10));
		expect(m.workflowExecutionService.fillDocumentSlot).not.toHaveBeenCalled();
		expect(m.scheduleRunMemory.createScheduleRun).not.toHaveBeenCalled();
		await m.scheduler.stop();
	});

	it("still records the run when markAutoRefreshSlotDone rejects; does NOT complete", async () => {
		const m = makeMocks();
		const errorSpy = jest
			.spyOn(loggers.agent, "error")
			.mockImplementation(() => loggers.agent);
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());
		m.documentMemory.markAutoRefreshSlotDone.mockRejectedValue(
			new Error("mongo down"),
		);
		await m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now());

		// The fill itself succeeded for both slots, so they count as slot
		// successes — but done-marking failed, so completion is skipped and
		// the next catch-up redoes the (idempotent) bookkeeping.
		expect(m.documentMemory.completeAutoRefresh).not.toHaveBeenCalled();
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				finishedAt: expect.any(Number),
				slotResults: expect.arrayContaining([
					expect.objectContaining({ slotId: "s1", status: "success" }),
					expect.objectContaining({ slotId: "s2", status: "success" }),
				]),
			}),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			"Auto-refresh slot bookkeeping failed",
			expect.objectContaining({ documentId: "doc-1", slotId: "s1" }),
		);
	});

	it("resolves and logs instead of rejecting when auto-refresh bookkeeping fails", async () => {
		const m = makeMocks();
		const errorSpy = jest
			.spyOn(loggers.agent, "error")
			.mockImplementation(() => loggers.agent);
		m.documentMemory.getDocument.mockRejectedValue(new Error("mongo down"));

		// Must not reject: tick() fires this call as void (fire-and-forget),
		// so a rejection here would become an unhandled rejection.
		await expect(
			m.scheduler.runAutoRefreshJob("doc-1", "once", Date.now()),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			"Auto-refresh run bookkeeping failed",
			expect.objectContaining({ documentId: "doc-1" }),
		);
	});
});

describe("SchedulerService — reconcileManualSlotFill", () => {
	afterEach(async () => {
		jest.restoreAllMocks();
	});

	// Slots default to status "resolved": reconciliation reads the document
	// AFTER the manual fill persisted its result, and only a slot whose
	// persisted status is "resolved" may be ledgered as done (a "no content
	// produced" fill resolves without throwing but persists "failed").
	function makeLogbookDocument(overrides: Record<string, unknown> = {}) {
		return {
			documentId: "doc-1",
			userId: "user-1",
			title: "로그북",
			format: "MARKDOWN",
			content: "{{slot:s1}} {{slot:s2}}",
			slots: [
				{ slotId: "s1", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-a" } },
				{ slotId: "s2", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-b" } },
				{ slotId: "no-binding", status: "empty" },
			],
			source: "MANUAL",
			version: 1,
			createdAt: "",
			updatedAt: "",
			autoRefresh: { runAt: Date.now() - 1000, active: true },
			...overrides,
		};
	}

	it("marks the slot done when it's a target of a pending autoRefresh", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(makeLogbookDocument());

		await m.scheduler.reconcileManualSlotFill("doc-1", "s1");

		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith(
			"doc-1",
			"s1",
		);
		expect(m.documentMemory.completeAutoRefresh).not.toHaveBeenCalled();
	});

	it("completes the auto-refresh and drops the pending entry when it's the last remaining target", async () => {
		jest.useFakeTimers();
		const m = makeMocks();
		const document = makeLogbookDocument({
			autoRefresh: { runAt: Date.now() - 1000, active: true, doneSlotIds: ["s1"] },
		});
		m.documentMemory.getDocument.mockResolvedValue(document);
		// biome-ignore lint/suspicious/noExplicitAny: test double
		m.scheduler.notifyDocumentAutoRefresh(document as any);

		await m.scheduler.reconcileManualSlotFill("doc-1", "s2");

		expect(m.documentMemory.markAutoRefreshSlotDone).toHaveBeenCalledWith(
			"doc-1",
			"s2",
		);
		expect(m.documentMemory.completeAutoRefresh).toHaveBeenCalledWith(
			"doc-1",
			expect.any(Number),
		);

		// Pending entry was dropped: tick must not dispatch anything for doc-1.
		m.scheduler.startTickForTest();
		await jest.advanceTimersByTimeAsync(60_000);
		jest.useRealTimers();
		await new Promise((r) => setTimeout(r, 10));
		expect(m.workflowExecutionService.fillDocumentSlot).not.toHaveBeenCalled();
		await m.scheduler.stop();
	});

	it("no-ops when autoRefresh is absent", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({ autoRefresh: undefined }),
		);
		await m.scheduler.reconcileManualSlotFill("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalled();
	});

	it("no-ops when autoRefresh is inactive", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				autoRefresh: { runAt: Date.now() - 1000, active: false },
			}),
		);
		await m.scheduler.reconcileManualSlotFill("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalled();
	});

	it("no-ops when autoRefresh is already completed", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				autoRefresh: {
					runAt: Date.now() - 1000,
					active: true,
					completedAt: Date.now(),
				},
			}),
		);
		await m.scheduler.reconcileManualSlotFill("doc-1", "s1");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalled();
	});

	it("no-ops when the slot is not a target of the pending autoRefresh", async () => {
		const m = makeMocks();
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				autoRefresh: { runAt: Date.now() - 1000, active: true, slotIds: ["s1"] },
			}),
		);
		await m.scheduler.reconcileManualSlotFill("doc-1", "s2");
		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalled();
	});

	it("does not mark done (or complete) when the slot's persisted status is not 'resolved'", async () => {
		const m = makeMocks();
		// A "no content produced" fill resolves without throwing but persists
		// status:"failed" on the slot — it must NOT be ledgered as done.
		m.documentMemory.getDocument.mockResolvedValue(
			makeLogbookDocument({
				slots: [
					{ slotId: "s1", status: "failed", error: "No content produced", binding: { type: "WORKFLOW", workflowId: "wf-a" } },
					{ slotId: "s2", status: "resolved", binding: { type: "WORKFLOW", workflowId: "wf-b" } },
				],
				autoRefresh: {
					runAt: Date.now() - 1000,
					active: true,
					doneSlotIds: ["s2"],
				},
			}),
		);

		await m.scheduler.reconcileManualSlotFill("doc-1", "s1");

		expect(m.documentMemory.markAutoRefreshSlotDone).not.toHaveBeenCalled();
		expect(m.documentMemory.completeAutoRefresh).not.toHaveBeenCalled();
	});

	it("never rejects when getDocument rejects; logs instead", async () => {
		const m = makeMocks();
		const errorSpy = jest
			.spyOn(loggers.agent, "error")
			.mockImplementation(() => loggers.agent);
		m.documentMemory.getDocument.mockRejectedValue(new Error("mongo down"));

		await expect(
			m.scheduler.reconcileManualSlotFill("doc-1", "s1"),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			"Manual fill auto-refresh reconciliation failed",
			expect.objectContaining({ documentId: "doc-1", slotId: "s1" }),
		);
	});
});
