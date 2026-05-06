import type { WorkflowTableBlock } from "@/types/memory";
import { WorkflowTableService } from "@/services/workflow-table.service";

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
			"Actual = col_sum(Breakfast, Lunch, Dinner, Midnight)",
			"Rev(%) = row_share(Rev, Actual)",
			"Cover(%) = row_share(Cover, Actual)",
			"AveCheck = row_ratio(Rev, Cover)",
			"vsPlanPct = col_rate(Actual, Plan)",
			"vsLYPct = col_rate(Actual, LastYear)",
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
			columnFormats: {},
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

	it("rejects matrix formulas that depend on later formulas", () => {
		const block: WorkflowTableBlock = {
			blockId: "daily-sales-ordered-differently",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "일일 매출 분석",
			rows: ["Rev", "Cover", "AveCheck"],
			columns: ["Breakfast", "Lunch", "Dinner", "Midnight", "Actual"],
			formulas: [
				"AveCheck = row_ratio(Rev, Cover)",
				"Actual = col_sum(Breakfast, Lunch, Dinner, Midnight)",
			],
		};
		const rawContent = JSON.stringify({
			Rev: {
				Breakfast: 0,
				Lunch: 7941181,
				Dinner: 8440036,
				Midnight: 0,
			},
			Cover: {
				Breakfast: 0,
				Lunch: 113,
				Dinner: 69,
				Midnight: 0,
			},
		});

		expect(() => service.renderTable(block, rawContent)).toThrow(
			'Matrix formula "AveCheck = row_ratio(Rev, Cover)" depends on values from later formulas:',
		);
	});

	it("supports row-wise difference formulas across columns", () => {
		const block: WorkflowTableBlock = {
			blockId: "row-delta",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "행 차이 계산",
			rows: ["Actual", "Plan", "Gap"],
			columns: ["Breakfast", "Lunch", "Dinner", "Total"],
			formulas: [
				"Total = col_sum(Breakfast, Lunch, Dinner)",
				"Gap = row_delta(Actual, Plan)",
			],
		};
		const rawContent = JSON.stringify({
			Actual: {
				Breakfast: 100,
				Lunch: 200,
				Dinner: 300,
			},
			Plan: {
				Breakfast: 90,
				Lunch: 180,
				Dinner: 320,
			},
		});

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				key: "Actual",
				kind: "data",
				cells: ["Actual", 100, 200, 300, 600],
			},
			{
				key: "Plan",
				kind: "data",
				cells: ["Plan", 90, 180, 320, 590],
			},
			{
				key: "Gap",
				kind: "data",
				cells: ["Gap", 10, 20, -20, 10],
			},
		]);
		expect(rendered.content).toContain(
			"| Gap | 10 | 20 | -20 | 10 |",
		);
	});

	it("keeps legacy matrix aliases working", () => {
		const block: WorkflowTableBlock = {
			blockId: "legacy-aliases",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "Legacy aliases",
			rows: ["Rev", "Rev(%)", "Cover", "AveCheck"],
			columns: ["Breakfast", "Lunch", "Actual"],
			formulas: [
				"Actual = sum(Breakfast, Lunch)",
				"Rev(%) = share(Rev, Actual)",
				"AveCheck = ratio(Rev, Cover)",
			],
		};
		const rawContent = JSON.stringify({
			Rev: { Breakfast: 50, Lunch: 150 },
			Cover: { Breakfast: 5, Lunch: 10 },
		});

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows[0].cells).toEqual(["Rev", 50, 150, 200]);
		expect(rendered.data.table.rows[1].cells).toEqual(["Rev(%)", 25, 75, 100]);
		expect(rendered.data.table.rows[3].cells).toEqual([
			"AveCheck",
			10,
			15,
			13.333333333333334,
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
			columnFormats: {},
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

	it("rejects record formulas that depend on later formulas", () => {
		const block: WorkflowTableBlock = {
			blockId: "record-formula-order",
			type: "table",
			layout: "records",
			title: "Formula order",
			columns: ["a", "b", "c", "d"],
			formulas: ["d = c / b", "c = a + b"],
		};
		const rawContent = JSON.stringify([{ a: 10, b: 5 }]);

		expect(() => service.renderTable(block, rawContent)).toThrow(
			'Record formula "d = c / b" depends on values from later formulas: c',
		);
	});

	it("does not treat all division formulas as percent columns", () => {
		const adrBlock: WorkflowTableBlock = {
			blockId: "adr-by-day",
			type: "table",
			layout: "records",
			title: "ADR by day",
			columns: ["date", "grandRNs", "grandRev", "grandADR"],
			formulas: ["grandADR = grandRev / grandRNs"],
		};
		const rawContent = JSON.stringify([
			{
				date: "2026-01-01",
				grandRNs: 9,
				grandRev: "1,260,000",
			},
		]);

		const rendered = service.renderTable(adrBlock, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["2026-01-01", 9, 1260000, 140000],
			},
		]);
		expect(rendered.content).toContain(
			"| 2026-01-01 | 9 | 1,260,000 | 140,000 |",
		);
		expect(rendered.content).not.toContain("%");
	});

	it("applies column formats for text, grouping, decimals, and suffixes", () => {
		const productBlock: WorkflowTableBlock = {
			blockId: "product-sales",
			type: "table",
			layout: "records",
			title: "상품별 매출",
			columns: ["상품코드", "QTY(개)", "REV(원)"],
			columnFormats: {
				상품코드: {
					kind: "text",
				},
				"QTY(개)": {
					kind: "number",
					grouping: false,
					decimals: 0,
					suffix: "개",
				},
				"REV(원)": {
					kind: "currency",
					grouping: true,
					decimals: 0,
					suffix: "원",
				},
			},
		};
		const rawContent = JSON.stringify([
			{
				상품코드: "9000176886",
				"QTY(개)": "266",
				"REV(원)": "14904541",
			},
		]);

		const rendered = service.renderTable(productBlock, rawContent);

		expect(rendered.data.spec).toEqual({
			layout: "records",
			columns: ["상품코드", "QTY(개)", "REV(원)"],
			formulas: undefined,
			columnFormats: productBlock.columnFormats,
		});
		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["9000176886", 266, 14904541],
			},
		]);
		expect(rendered.content).toContain("| 9000176886 | 266개 | 14,904,541원 |");
	});

	it("keeps numeric JSON values unformatted for text columns", () => {
		const productBlock: WorkflowTableBlock = {
			blockId: "product-sales",
			type: "table",
			layout: "records",
			title: "상품별 매출",
			columns: ["상품코드", "QTY(개)", "REV(원)"],
			columnFormats: {
				상품코드: {
					kind: "text",
					grouping: false,
				},
				"QTY(개)": {
					kind: "number",
					grouping: false,
				},
				"REV(원)": {
					kind: "currency",
					grouping: true,
				},
			},
		};
		const rawContent = JSON.stringify([
			{
				상품코드: 9000176600,
				"QTY(개)": 4,
				"REV(원)": 409091,
			},
		]);

		const rendered = service.renderTable(productBlock, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["9000176600", 4, 409091],
			},
		]);
		expect(rendered.content).toContain("| 9000176600 | 4 | 409,091 |");
		expect(rendered.content).not.toContain("9,000,176,600");
	});

	it("normalizes grouped numeric strings for text identifier columns", () => {
		const productBlock: WorkflowTableBlock = {
			blockId: "product-sales",
			type: "table",
			layout: "records",
			title: "상품별 매출",
			columns: ["상품코드", "QTY(개)", "REV(원)"],
			columnFormats: {
				상품코드: {
					kind: "text",
					grouping: false,
				},
				"QTY(개)": {
					kind: "number",
					grouping: false,
				},
				"REV(원)": {
					kind: "currency",
					grouping: true,
				},
			},
		};
		const rawContent = JSON.stringify([
			{
				상품코드: "9,000,176,600",
				"QTY(개)": 4,
				"REV(원)": 409091,
			},
		]);

		const rendered = service.renderTable(productBlock, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["9000176600", 4, 409091],
			},
		]);
		expect(rendered.content).toContain("| 9000176600 | 4 | 409,091 |");
		expect(rendered.content).not.toContain("9,000,176,600");
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
		expect(prompt).toContain("Column format guidance:");
		expect(prompt).toContain(
			"- store: return a raw string, number, or null without display formatting.",
		);
		expect(extractionSection).not.toContain("- netSales");
		expect(prompt).toContain("Do not add total rows.");
		expect(prompt).toContain(
			"Do not apply display formatting such as digit grouping commas, currency symbols, unit suffixes, or percent signs",
		);
	});

	it("builds text-column guidance for identifier fields", () => {
		const productBlock: WorkflowTableBlock = {
			blockId: "product-sales",
			type: "table",
			layout: "records",
			title: "상품별 매출",
			columns: ["상품코드", "QTY(개)", "REV(원)"],
			columnFormats: {
				상품코드: {
					kind: "text",
					grouping: false,
				},
				"QTY(개)": {
					kind: "number",
					grouping: false,
				},
				"REV(원)": {
					kind: "currency",
					grouping: true,
				},
			},
		};

		const prompt = service.buildExtractionPrompt(
			productBlock,
			"[task-3] Product Sales\nStatus: completed\nResult:\n...",
		);

		expect(prompt).toContain("Column format guidance:");
		expect(prompt).toContain(
			"- 상품코드: treat as text/identifier. Preserve the source text exactly and never add digit grouping commas or numeric formatting.",
		);
		expect(prompt).toContain(
			"- REV(원): return a raw number or null, without currency symbols or display formatting.",
		);
	});
});
