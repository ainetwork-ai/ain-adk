import express from "express";
import request from "supertest";
import { AuthMiddleware } from "@/middlewares/auth.middleware";
import { requestContextMiddleware } from "@/middlewares/request-context.middleware";
import type { AuthModule } from "@/modules";
import { getRequestContext } from "@/utils/request-context";

const buildApp = (auth: AuthModule | undefined) => {
	const app = express();
	app.use(requestContextMiddleware());
	app.use(new AuthMiddleware(auth).middleware());
	app.get("/whoami", (_req, res) => {
		res.json({ context: getRequestContext() ?? null });
	});
	return app;
};

describe("AuthMiddleware request context", () => {
	it("adds the authenticated userId to the request context", async () => {
		const auth = {
			authenticate: async () => ({ isAuthenticated: true, userId: "u-42" }),
		} as unknown as AuthModule;

		const res = await request(buildApp(auth)).get("/whoami");
		expect(res.status).toBe(200);
		expect(res.body.context.userId).toBe("u-42");
	});

	it("leaves the context without userId when auth is skipped", async () => {
		const res = await request(buildApp(undefined)).get("/whoami");
		expect(res.status).toBe(200);
		expect(res.body.context.userId).toBeUndefined();
		expect(res.body.context.requestId).toBeDefined();
	});
});
