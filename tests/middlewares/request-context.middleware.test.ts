import express from "express";
import request from "supertest";
import {
	accessLogMiddleware,
	requestContextMiddleware,
} from "@/middlewares/request-context.middleware";
import { loggers } from "@/utils/logger";
import { getRequestContext } from "@/utils/request-context";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let infoSpy: jest.SpyInstance;

beforeEach(() => {
	infoSpy = jest.spyOn(loggers.http, "info").mockReturnValue(loggers.http);
});

afterEach(() => {
	infoSpy.mockRestore();
});

const buildApp = () => {
	const app = express();
	app.use(requestContextMiddleware());
	app.use(accessLogMiddleware());
	app.get("/echo-context", async (_req, res) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		res.json({ context: getRequestContext() ?? null });
	});
	app.get("/", (_req, res) => {
		res.send("ok");
	});
	return app;
};

describe("requestContextMiddleware", () => {
	it("generates a request id, exposes it in context and response header", async () => {
		const res = await request(buildApp()).get("/echo-context");
		const headerId = res.headers["x-request-id"];
		expect(headerId).toMatch(UUID_RE);
		expect(res.body.context.requestId).toBe(headerId);
	});

	it("reuses a valid incoming X-Request-Id header", async () => {
		const res = await request(buildApp())
			.get("/echo-context")
			.set("X-Request-Id", "client-id-123");
		expect(res.headers["x-request-id"]).toBe("client-id-123");
		expect(res.body.context.requestId).toBe("client-id-123");
	});

	it("ignores an unsafe incoming header and generates a fresh id", async () => {
		const res = await request(buildApp())
			.get("/echo-context")
			.set("X-Request-Id", "bad id\twith spaces");
		expect(res.headers["x-request-id"]).toMatch(UUID_RE);
	});

	it("gives concurrent requests distinct contexts", async () => {
		const app = buildApp();
		const [a, b] = await Promise.all([
			request(app).get("/echo-context"),
			request(app).get("/echo-context"),
		]);
		expect(a.body.context.requestId).not.toBe(b.body.context.requestId);
	});
});

describe("accessLogMiddleware", () => {
	it("logs one completion line with method, path, status, duration and requestId", async () => {
		await request(buildApp())
			.get("/echo-context?x=1")
			.set("X-Request-Id", "req-log-1");

		expect(infoSpy).toHaveBeenCalledTimes(1);
		const [message, meta] = infoSpy.mock.calls[0];
		expect(message).toBe("HTTP request");
		expect(meta).toMatchObject({
			method: "GET",
			path: "/echo-context?x=1",
			status: 200,
			requestId: "req-log-1",
		});
		expect(typeof meta.durationMs).toBe("number");
	});

	it("skips health-check style paths", async () => {
		await request(buildApp()).get("/");
		expect(infoSpy).not.toHaveBeenCalled();
	});
});
