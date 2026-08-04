import type { NextFunction, Request, Response } from "express";
import { UserWorkflowApiController } from "@/controllers/api/user-workflow.api.controller";
import type { UserWorkflow } from "@/types/memory";

function wf(id: string, updatedAt: string): UserWorkflow {
	return { workflowId: id, userId: "u1", updatedAt } as UserWorkflow;
}

function makeController(service: object) {
	return new UserWorkflowApiController(
		service as never,
		{} as never,
		{} as never,
		{} as never,
	);
}

function mockRes(): Response & { _json?: unknown } {
	const res: any = { locals: { userId: "u1" } };
	res.json = (b: unknown) => {
		res._json = b;
		return res;
	};
	return res;
}

const next: NextFunction = (err?: unknown) => {
	if (err) throw err;
};

describe("handleGetAllWorkflows", () => {
	it("no limit → bare array (legacy)", async () => {
		const controller = makeController({
			listWorkflows: async () => [wf("a", "2026-08-01")],
		});
		const res = mockRes();
		await controller.handleGetAllWorkflows(
			{ query: {} } as unknown as Request,
			res,
			next,
		);
		expect(Array.isArray(res._json)).toBe(true);
	});

	it("limit + count-capable provider → envelope, options passed through", async () => {
		const listWorkflows = jest.fn(async () => [wf("a", "2026-08-01")]);
		const controller = makeController({
			listWorkflows,
			countWorkflows: async () => 7,
		});
		const res = mockRes();
		await controller.handleGetAllWorkflows(
			{ query: { limit: "5", offset: "10" } } as unknown as Request,
			res,
			next,
		);
		expect(res._json).toEqual({
			items: [wf("a", "2026-08-01")],
			total: 7,
			limit: 5,
			offset: 10,
		});
		expect(listWorkflows).toHaveBeenCalledWith("u1", { limit: 5, offset: 10 });
	});

	it("limit + legacy provider (no count) → in-memory sort/slice, honest total", async () => {
		const controller = makeController({
			listWorkflows: async () => [
				wf("old", "2026-08-01"),
				wf("new", "2026-08-03"),
				wf("mid", "2026-08-02"),
			],
			countWorkflows: async () => undefined,
		});
		const res = mockRes();
		await controller.handleGetAllWorkflows(
			{ query: { limit: "2", offset: "0" } } as unknown as Request,
			res,
			next,
		);
		const body = res._json as { items: UserWorkflow[]; total: number };
		expect(body.total).toBe(3);
		expect(body.items.map((w) => w.workflowId)).toEqual(["new", "mid"]);
	});
});
