import { JobRunnerService } from "@/services/job-runner.service";
import { SchedulerService } from "@/services/scheduler.service";
import type { UserWorkflow } from "@/types/memory";
import { loggers } from "@/utils/logger";

function makeWorkflow(overrides: Partial<UserWorkflow> = {}): UserWorkflow {
	return {
		workflowId: "wf-1",
		userId: "user-1",
		title: "테스트 워크플로우",
		active: true,
		content: "",
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

describe("SchedulerService — document auto refresh", () => {
	afterEach(async () => {
		jest.restoreAllMocks();
	});

	function makeLogbookDocument(overrides: Record<string, unknown> = {}) {
		return {
			documentId: "doc-1",
			userId: "user-1",
			title: "로그북",
			format: "MARKDOWN",
			content: "{{slot:s1}} {{slot:s2}}",
			slots: [
				{ slotId: "s1", status: "empty", binding: { type: "WORKFLOW", workflowId: "wf-a" } },
				{ slotId: "s2", status: "empty", binding: { type: "WORKFLOW", workflowId: "wf-b" } },
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
		expect(m.scheduleRunMemory.updateScheduleRun).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed" }),
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
