import { DocumentAdviceService } from "@/services/document-advice.service";
import type { MemoryModule, ModelModule } from "@/modules";

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
	const out: unknown[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe("DocumentAdviceService", () => {
	const document = {
		documentId: "doc-1",
		userId: "u1",
		title: "Log",
		format: "MARKDOWN",
		content: "## 매출\n{{slot:rev}}\n",
		version: 2,
		source: "MANUAL",
		slots: [
			{
				slotId: "rev",
				status: "resolved",
				fragment: { content: "총매출 100만원", source: { type: "QUERY", query: "" }, resolvedAt: "t" },
			},
		],
		createdAt: "t0",
		updatedAt: "t0",
	};

	function makeModules(updateDocument = jest.fn(async () => undefined)) {
		const model = {
			generateMessages: jest.fn(() => [{ role: "user", content: "x" }]),
			fetchStreamWithContextMessage: jest.fn(async () => ({
				async *[Symbol.asyncIterator]() {
					yield { delta: { content: "좋은 " } };
					yield { delta: { content: "하루였습니다." } };
				},
			})),
		};
		const modelModule = {
			getModel: () => model,
			getModelOptions: () => ({}),
		} as unknown as ModelModule;
		const memoryModule = {
			getDocumentMemory: () => ({
				getDocument: jest.fn(async () => document),
				updateDocument,
			}),
			getAgentMemory: () => ({}),
		} as unknown as MemoryModule;
		return { modelModule, memoryModule, model, updateDocument };
	}

	it("streams advice text and caches it on the document", async () => {
		const { modelModule, memoryModule, updateDocument } = makeModules();
		const service = new DocumentAdviceService(modelModule, memoryModule);

		const events = await collect(service.generateAdviceStream("doc-1"));

		const text = events
			.filter((e: any) => e.event === "text_chunk")
			.map((e: any) => e.data.delta)
			.join("");
		expect(text).toBe("좋은 하루였습니다.");

		const lastCall = updateDocument.mock.calls.at(-1);
		expect(lastCall?.[0]).toBe("doc-1");
		expect((lastCall?.[1] as any).advice.content).toBe("좋은 하루였습니다.");
		expect(typeof (lastCall?.[1] as any).advice.generatedAt).toBe("string");
	});

	it("does not persist when the model produces no content", async () => {
		const { modelModule, memoryModule, model, updateDocument } = makeModules();
		(model.fetchStreamWithContextMessage as jest.Mock).mockResolvedValue({
			async *[Symbol.asyncIterator]() {},
		});
		const service = new DocumentAdviceService(modelModule, memoryModule);
		await collect(service.generateAdviceStream("doc-1"));
		expect(updateDocument).not.toHaveBeenCalled();
	});
});
