import type { WorkflowTableBlock } from "../types/memory";
import { WorkflowTableService } from "./workflow-table.service";

describe("WorkflowTableService", () => {
	const service = new WorkflowTableService();
	const matrixBlock: WorkflowTableBlock = {
		blockId: "daily-sales",
		type: "table",
		layout: "matrix",
		rowHeader: "구분",
		title: "일일 매출 분석",
		rows: ["Rev", "Rev(%)", "Cover", "Cover(%)", "AveCheck"],
		columns: [
			"Breakfast",
			"Lunch",
			"Dinner",
			"Midnight",
			"Actual",
			"Plan",
			"LastYear",
			"vsPlanPct",
			"vsLYPct",
		],
		formulas: [
			"Actual = sum(Breakfast, Lunch, Dinner, Midnight)",
			"Rev(%) = share(Rev, Actual)",
			"Cover(%) = share(Cover, Actual)",
			"AveCheck = ratio(Rev, Cover)",
			"vsPlanPct = rate(Actual, Plan)",
			"vsLYPct = rate(Actual, LastYear)",
		],
	};
	const recordBlock: WorkflowTableBlock = {
		blockId: "store-sales",
		type: "table",
		layout: "records",
		title: "매장별 매출",
		columns: ["store", "grossSales", "refunds", "netSales"],
		formulas: [
			"netSales = grossSales - refunds",
			"@total = sum(grossSales, refunds, netSales)",
		],
	};

	it("renders a deterministic matrix table from extracted JSON", () => {
		const rawContent = JSON.stringify({
			Rev: {
				Breakfast: 0,
				Lunch: "7,941,181",
				Dinner: 8440036,
				Midnight: 0,
				Plan: 25000000,
				LastYear: 32256668,
			},
			Cover: {
				Breakfast: 0,
				Lunch: 113,
				Dinner: 69,
				Midnight: 0,
				Plan: 220,
				LastYear: 301,
			},
		});

		const rendered = service.renderTable(matrixBlock, rawContent);

		expect(rendered.data.spec).toEqual({
			layout: "matrix",
			rowHeader: "구분",
			rows: ["Rev", "Rev(%)", "Cover", "Cover(%)", "AveCheck"],
			columns: [
				"Breakfast",
				"Lunch",
				"Dinner",
				"Midnight",
				"Actual",
				"Plan",
				"LastYear",
				"vsPlanPct",
				"vsLYPct",
			],
			formulas: matrixBlock.formulas,
		});
		expect(rendered.data.table.headers).toEqual([
			"구분",
			"Breakfast",
			"Lunch",
			"Dinner",
			"Midnight",
			"Actual",
			"Plan",
			"LastYear",
			"vsPlanPct",
			"vsLYPct",
		]);
		expect(rendered.data.table.rows[0].key).toBe("Rev");
		expect(rendered.data.table.rows[0].kind).toBe("data");
		expect(rendered.data.table.rows[0].cells.slice(0, 8)).toEqual([
			"Rev",
			0,
			7941181,
			8440036,
			0,
			16381217,
			25000000,
			32256668,
		]);
		expect(rendered.data.table.rows[0].cells[8]).toBeCloseTo(65.524868, 6);
		expect(rendered.data.table.rows[0].cells[9]).toBeCloseTo(
			50.78397123968291,
			6,
		);
		expect(rendered.data.table.rows[1].cells[2]).toBeCloseTo(48.4776, 3);
		expect(rendered.content).toContain(
			"| Rev | 0 | 7,941,181 | 8,440,036 | 0 | 16,381,217 | 25,000,000 | 32,256,668 | 65.5% | 50.8% |",
		);
		expect(rendered.content).toContain(
			"| Rev(%) | 0% | 48.5% | 51.5% | 0% | 100% | - | - | - | - |",
		);
		expect(rendered.data.warnings).toEqual([
			"Skipped AveCheck.Breakfast because the denominator is 0.",
			"Skipped AveCheck.Midnight because the denominator is 0.",
		]);
	});

	it("builds a matrix extraction prompt with only source rows and source columns", () => {
		const prompt = service.buildExtractionPrompt(
			matrixBlock,
			"[task-1] Daily Sales\nStatus: completed\nResult:\n...",
		);
		const extractionSection = prompt.split(
			"Formulas for later calculation:",
		)[0];

		expect(extractionSection).toContain("Rows to extract:\n- Rev\n- Cover");
		expect(extractionSection).toContain(
			"Columns to extract:\n- Breakfast\n- Lunch\n- Dinner\n- Midnight\n- Plan\n- LastYear",
		);
		expect(extractionSection).not.toContain("- Rev(%)");
		expect(extractionSection).not.toContain(
			"- Actual\n- Plan\n- LastYear\n- vsPlanPct",
		);
	});

	it("renders a deterministic record table with computed columns and a total row", () => {
		const rawContent = JSON.stringify([
			{ store: "Gangnam", grossSales: "1,200,000", refunds: "50,000" },
			{ store: "Hongdae", grossSales: 900000, refunds: 30000 },
		]);

		const rendered = service.renderTable(recordBlock, rawContent);

		expect(rendered.data.spec).toEqual({
			layout: "records",
			columns: ["store", "grossSales", "refunds", "netSales"],
			formulas: recordBlock.formulas,
		});
		expect(rendered.data.table.headers).toEqual([
			"store",
			"grossSales",
			"refunds",
			"netSales",
		]);
		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["Gangnam", 1200000, 50000, 1150000],
			},
			{
				kind: "data",
				cells: ["Hongdae", 900000, 30000, 870000],
			},
			{
				kind: "total",
				cells: ["Total", 2100000, 80000, 2020000],
			},
		]);
		expect(rendered.data.warnings).toEqual([]);
		expect(rendered.content).toContain(
			"| Gangnam | 1,200,000 | 50,000 | 1,150,000 |",
		);
		expect(rendered.content).toContain(
			"| **Total** | **2,100,000** | **80,000** | **2,020,000** |",
		);
	});

	it("builds a record extraction prompt with only source columns", () => {
		const prompt = service.buildExtractionPrompt(
			recordBlock,
			"[task-2] Store Sales\nStatus: completed\nResult:\n...",
		);
		const extractionSection = prompt.split(
			"Formulas for later calculation:",
		)[0];

		expect(extractionSection).toContain(
			"Columns to extract:\n- store\n- grossSales\n- refunds",
		);
		expect(extractionSection).not.toContain("- netSales");
		expect(prompt).toContain("Do not add total rows.");
	});
});
