import type { ModelModule } from "@/modules";
import { WorkflowResponseComposer } from "@/services/workflow-response-composer.service";
import type {
	WorkflowRenderedBlock,
	WorkflowTaskResult,
} from "@/types/memory";

async function collectGenerator<TYield, TReturn>(
	stream: AsyncGenerator<TYield, TReturn, unknown>,
): Promise<{ result: TReturn }> {
	let next = await stream.next();
	while (!next.done) {
		next = await stream.next();
	}

	return { result: next.value };
}

async function* streamText(text: string) {
	yield {
		delta: {
			content: text,
		},
	};
}

describe("WorkflowResponseComposer", () => {
	const taskResults: Record<string, WorkflowTaskResult> = {
		"task-1": {
			taskId: "task-1",
			title: "Collect sales",
			status: "completed",
			content: "Sales data collected.",
			startedAt: 1,
			completedAt: 2,
		},
	};
	const renderedTable: WorkflowRenderedBlock = {
		blockId: "sales-table",
		type: "table",
		content: "| Store | Sales |\n| --- | ---: |\n| A | 100 |",
		data: {
			spec: {
				layout: "records",
				columns: ["Store", "Sales"],
			},
			table: {
				headers: ["Store", "Sales"],
				rows: [{ cells: ["A", 100] }],
			},
		},
	};
	const renderedGraph: WorkflowRenderedBlock = {
		blockId: "sales-graph",
		type: "graph",
		content: "```mermaid\npie\n  \"A\" : 100\n```",
		data: {
			spec: {
				graphType: "pie",
				slices: [{ label: "A", value: 100 }],
			},
			mermaid: 'pie\n  "A" : 100',
		},
	};

	it("includes referenced rendered table and graph blocks when generating text", async () => {
		const generateMessages = jest.fn(({ query }) => [{ role: "user", query }]);
		const modelModule = {
			getModel: () => ({
				generateMessages,
				fetchStreamWithContextMessage: jest.fn(() => streamText("summary")),
			}),
			getModelOptions: () => ({}),
		} as unknown as ModelModule;
		const composer = new WorkflowResponseComposer(modelModule);

		const { result } = await collectGenerator(
			composer.renderResponseBlock(
				{
					blockId: "summary",
					type: "text",
					sourceBlockIds: ["sales-table", "sales-graph"],
					prompt: "Summarize the rendered evidence.",
				},
				taskResults,
				[renderedTable, renderedGraph],
			),
		);

		const query = generateMessages.mock.calls[0][0].query;
		expect(query).toContain("Already-rendered blocks");
		expect(query).toContain("[sales-table] table");
		expect(query).toContain("[sales-graph] graph");
		expect(query).toContain('"headers": [');
		expect(result.content).toBe("summary\n\n");
	});

	it("includes referenced rendered table blocks when extracting graph data", async () => {
		const generateMessages = jest.fn(({ query }) => [{ role: "user", query }]);
		const modelModule = {
			getModel: () => ({
				generateMessages,
				fetch: jest.fn(async () => ({
					content: JSON.stringify({
						slices: [{ label: "A", value: 100 }],
					}),
				})),
			}),
			getModelOptions: () => ({}),
		} as unknown as ModelModule;
		const composer = new WorkflowResponseComposer(modelModule);

		const { result } = await collectGenerator(
			composer.renderResponseBlock(
				{
					blockId: "share-graph",
					type: "graph",
					graphType: "pie",
					sourceBlockIds: ["sales-table"],
					prompt: "Build a graph from the sales table.",
				},
				taskResults,
				[renderedTable, renderedGraph],
			),
		);

		const query = generateMessages.mock.calls[0][0].query;
		expect(query).toContain("Rendered response blocks:");
		expect(query).toContain("[sales-table] table");
		expect(query).not.toContain("[sales-graph] graph");
		expect(result.content).toContain("```mermaid");
		expect(result.data?.mermaid).toContain('"A" : 100');
	});
});
