import { JobRunnerService } from "@/services/job-runner.service";
import { SchedulerService } from "@/services/scheduler.service";
import type { UserWorkflow } from "@/types/memory";

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
