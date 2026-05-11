import { WorkflowGraphService } from "@/services/workflow-graph.service";
import type { WorkflowGraphBlock } from "@/types/memory";

describe("WorkflowGraphService", () => {
	const service = new WorkflowGraphService();

	it("renders a Mermaid xychart-beta graph from extracted JSON", () => {
		const block: WorkflowGraphBlock = {
			blockId: "monthly-sales",
			type: "graph",
			graphType: "xychart-beta",
			title: "월별 매출 및 계획비 비교",
			prompt: "월별 매출 데이터를 그래프로 정리한다.",
		};

		const rawContent = JSON.stringify({
			xAxis: ["1월", "2월", "3월"],
			yAxis: {
				label: "매출액",
				min: 0,
				max: "3000000000",
			},
			series: [
				{
					kind: "bar",
					label: "25년 실적(원)",
					data: [1200000000, "1600000000", 2100000000],
				},
				{
					kind: "line",
					label: "24년 계획(원)",
					data: [1100000000, 1500000000, 2000000000],
				},
			],
		});

		const rendered = service.renderGraph(block, rawContent);

		expect(rendered.data.spec).toEqual({
			graphType: "xychart-beta",
			title: "월별 매출 및 계획비 비교",
			xAxis: ["1월", "2월", "3월"],
			yAxis: {
				label: "매출액",
				min: 0,
				max: 3000000000,
			},
			series: [
				{
					kind: "bar",
					label: "25년 실적(원)",
					data: [1200000000, 1600000000, 2100000000],
				},
				{
					kind: "line",
					label: "24년 계획(원)",
					data: [1100000000, 1500000000, 2000000000],
				},
			],
		});
		expect(rendered.data.mermaid).toContain("xychart-beta");
		expect(rendered.data.mermaid).toContain(
			'y-axis "매출액" 0 --> 3000000000',
		);
		expect(rendered.data.mermaid).toContain(
			'bar "25년 실적(원)" [1200000000, 1600000000, 2100000000]',
		);
		expect(rendered.content).toContain("```mermaid");
	});

	it("renders a Mermaid pie graph and respects block showData override", () => {
		const block: WorkflowGraphBlock = {
			blockId: "sales-share",
			type: "graph",
			graphType: "pie",
			title: "매출 비중",
			showData: true,
			prompt: "매출 비중을 카테고리별로 정리한다.",
		};

		const rawContent = `\`\`\`json
{
  "showData": false,
  "slices": [
    { "label": "식사", "value": 65.5 },
    { "label": "주류", "value": "34.5" }
  ]
}
\`\`\``;

		const rendered = service.renderGraph(block, rawContent);

		expect(rendered.data.spec).toEqual({
			graphType: "pie",
			title: "매출 비중",
			showData: true,
			slices: [
				{ label: "식사", value: 65.5 },
				{ label: "주류", value: 34.5 },
			],
		});
		expect(rendered.data.mermaid).toContain("pie showData");
		expect(rendered.data.mermaid).toContain('title "매출 비중"');
		expect(rendered.data.mermaid).toContain('"식사" : 65.5');
		expect(rendered.data.mermaid).toContain('"주류" : 34.5');
	});
});
