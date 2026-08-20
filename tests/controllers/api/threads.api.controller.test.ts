import type { NextFunction, Request, Response } from "express";
import { ThreadApiController } from "@/controllers/api/threads.api.controller";
import { MessageRole, ThreadType } from "@/types/memory";

describe("ThreadApiController", () => {
	it("returns canonical thread messages from legacy stored records", async () => {
		const controller = new ThreadApiController({
			getThreadMemory: () => ({
				getThread: jest.fn(async () => ({
					userId: "user-1",
					threadId: "thread-1",
					type: ThreadType.CHAT,
					title: "Thread",
					messages: [
						{
							messageId: "legacy-msg-1",
							role: MessageRole.USER,
							timestamp: 100,
							content: {
								type: "text",
								parts: ["legacy hello"],
							},
						},
					],
				})),
			}),
		} as any);

		const json = jest.fn();
		const req = { params: { id: "thread-1" } } as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			json,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleGetThread(req, res, next);

		expect(json).toHaveBeenCalledWith({
			userId: "user-1",
			threadId: "thread-1",
			type: ThreadType.CHAT,
			title: "Thread",
			messages: [
				{
					messageId: "legacy-msg-1",
					role: MessageRole.USER,
					timestamp: 100,
					metadata: undefined,
					schemaVersion: 2,
					parts: [{ kind: "text", text: "legacy hello" }],
				},
			],
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("cleans up thread artifacts when deleting a thread", async () => {
		const deleteThread = jest.fn(async () => {});
		const deleteThreadArtifacts = jest.fn(async () => {});
		const controller = new ThreadApiController(
			{
				getThreadMemory: () => ({ deleteThread }),
			} as any,
			{ deleteThreadArtifacts } as any,
		);

		const send = jest.fn();
		const status = jest.fn().mockReturnValue({ send });
		const req = { params: { id: "thread-1" } } as unknown as Request;
		const res = {
			locals: { userId: "user-1" },
			status,
		} as unknown as Response;
		const next = jest.fn() as NextFunction;

		await controller.handleDeleteThread(req, res, next);

		expect(deleteThread).toHaveBeenCalledWith("user-1", "thread-1");
		expect(deleteThreadArtifacts).toHaveBeenCalledWith("user-1", "thread-1");
		expect(status).toHaveBeenCalledWith(200);
		expect(next).not.toHaveBeenCalled();
	});
});
