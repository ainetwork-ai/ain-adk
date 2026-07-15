import { UserWorkflowCoordinatorService } from "@/services/user-workflow-coordinator.service";

describe("UserWorkflowCoordinatorService cron validation", () => {
	const userWorkflowService = {
		createWorkflow: jest.fn(),
		updateWorkflow: jest.fn(),
		getWorkflow: jest.fn(),
		deleteWorkflow: jest.fn(),
	};
	const schedulerService = {
		scheduleWorkflow: jest.fn(),
		rescheduleWorkflow: jest.fn(),
		unscheduleWorkflow: jest.fn(),
	};
	const coordinator = new UserWorkflowCoordinatorService(
		// biome-ignore lint/suspicious/noExplicitAny: test doubles
		userWorkflowService as any,
		// biome-ignore lint/suspicious/noExplicitAny: test doubles
		schedulerService as any,
	);

	it("rejects an invalid cron expression on create", async () => {
		await expect(
			coordinator.createWorkflow({
				workflowId: "wf-1",
				userId: "u",
				title: "t",
				active: true,
				content: "",
				schedule: "not a cron",
			}),
		).rejects.toThrow(/Invalid cron/);
		expect(userWorkflowService.createWorkflow).not.toHaveBeenCalled();
	});

	it("rejects an invalid cron expression on update", async () => {
		await expect(
			coordinator.updateWorkflow("wf-1", { schedule: "99 99 * * *" }),
		).rejects.toThrow(/Invalid cron/);
	});
});
