import { getArtifactModule } from "@/config/modules";
import { MCPModule } from "@/modules/mcp/mcp.module";
import { CONNECTOR_PROTOCOL_TYPE } from "@/types/connector";
import type { StreamEvent } from "@/types/stream";

jest.mock("@/config/modules", () => ({
	getArtifactModule: jest.fn(),
}));

const TOOL = {
	toolName: "srv-gen",
	connectorName: "srv",
	protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
};

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

function makeModule(callToolResult: unknown): MCPModule {
	const module = new MCPModule();
	module.addMCPConnector({ srv: {} as any });
	(module as any).mcpConnectors.get("srv").client = {
		callTool: jest.fn(async () => callToolResult),
	};
	return module;
}

async function drain(
	gen: AsyncGenerator<StreamEvent, string, unknown>,
): Promise<{ events: StreamEvent[]; result: string }> {
	const events: StreamEvent[] = [];
	let next = await gen.next();
	while (!next.done) {
		events.push(next.value);
		next = await gen.next();
	}
	return { events, result: next.value };
}

describe("MCPModule.useTool binary outputs", () => {
	beforeEach(() => {
		jest.mocked(getArtifactModule).mockReset();
	});

	it("stores image blocks as artifacts and yields artifact_ready", async () => {
		const put = jest.fn(async (input: any) => ({
			artifactId: "art-1",
			status: "ready" as const,
			name: input.name,
			mimeType: input.mimeType,
			size: input.data.byteLength,
			storageKey: "art-1.bin",
			userId: input.userId,
			threadId: input.threadId,
			createdAt: 1,
		}));
		jest
			.mocked(getArtifactModule)
			.mockReturnValue({ getStore: () => ({ put }) } as any);

		const module = makeModule({
			content: [
				{ type: "text", text: "generated!" },
				{ type: "image", data: PNG_BASE64, mimeType: "image/png" },
			],
		});

		const { events, result } = await drain(
			module.useTool(TOOL, { q: 1 }, { userId: "user-1", threadId: "thread-1" }),
		);

		expect(events).toEqual([
			{
				event: "artifact_ready",
				data: expect.objectContaining({
					kind: "artifact",
					artifactId: "art-1",
					mimeType: "image/png",
					downloadUrl: "/api/artifacts/art-1/download",
				}),
			},
		]);
		expect(put).toHaveBeenCalledWith(
			expect.objectContaining({
				mimeType: "image/png",
				userId: "user-1",
				threadId: "thread-1",
			}),
		);
		expect(
			new TextDecoder().decode(put.mock.calls[0][0].data as Uint8Array),
		).toBe("fake-png-bytes");
		expect(result).toContain("generated!");
		expect(result).toContain("art-1");
		expect(result).not.toContain(PNG_BASE64);
	});

	it("stores resource blob blocks as artifacts", async () => {
		const put = jest.fn(async (input: any) => ({
			artifactId: "art-2",
			status: "ready" as const,
			name: input.name,
			mimeType: input.mimeType,
			size: input.data.byteLength,
			storageKey: "art-2.bin",
			createdAt: 1,
		}));
		jest
			.mocked(getArtifactModule)
			.mockReturnValue({ getStore: () => ({ put }) } as any);

		const module = makeModule({
			content: [
				{
					type: "resource",
					resource: {
						uri: "file:///out/report.pdf",
						mimeType: "application/pdf",
						blob: PNG_BASE64,
					},
				},
			],
		});

		const { events, result } = await drain(module.useTool(TOOL, {}));

		expect(events).toHaveLength(1);
		expect(put).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "report.pdf",
				mimeType: "application/pdf",
			}),
		);
		expect(result).not.toContain(PNG_BASE64);
	});

	it("omits binary payloads when no artifact store is configured", async () => {
		jest.mocked(getArtifactModule).mockReturnValue(undefined);

		const module = makeModule({
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: PNG_BASE64, mimeType: "image/png" },
			],
		});

		const { events, result } = await drain(module.useTool(TOOL, {}));

		expect(events).toEqual([]);
		expect(result).toContain("hello");
		expect(result).not.toContain(PNG_BASE64);
		expect(result).toContain("artifact storage not configured");
	});

	it("keeps text-only results unchanged", async () => {
		jest.mocked(getArtifactModule).mockReturnValue(undefined);

		const module = makeModule({
			content: [{ type: "text", text: "plain answer" }],
		});

		const { events, result } = await drain(module.useTool(TOOL, {}));

		expect(events).toEqual([]);
		expect(result).toContain("plain answer");
	});
});
