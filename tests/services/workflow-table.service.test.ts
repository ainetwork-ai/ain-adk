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
		unit: "원",
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
		expect(rendered.data.metadata).toEqual({ unit: "원" });
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

	it("hides matrix rows and columns from output after formulas are evaluated", () => {
		const block: WorkflowTableBlock = {
			...matrixBlock,
			blockId: "daily-sales-hidden",
			hiddenRows: ["Rev(%)", "Cover(%)"],
			hiddenColumns: ["Plan", "LastYear"],
		};
		const rawContent = JSON.stringify({
			Rev: {
				Breakfast: 100,
				Lunch: 200,
				Dinner: 300,
				Midnight: 0,
				Plan: 1000,
				LastYear: 800,
			},
			Cover: {
				Breakfast: 10,
				Lunch: 20,
				Dinner: 30,
				Midnight: 0,
				Plan: 100,
				LastYear: 80,
			},
		});

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.spec).toMatchObject({
			layout: "matrix",
			rows: ["Rev", "Cover", "AveCheck"],
			columns: [
				"Breakfast",
				"Lunch",
				"Dinner",
				"Midnight",
				"Actual",
				"vsPlanPct",
				"vsLYPct",
			],
			hiddenRows: ["Rev(%)", "Cover(%)"],
			hiddenColumns: ["Plan", "LastYear"],
		});
		expect(rendered.data.table.headers).toEqual([
			"구분",
			"Breakfast",
			"Lunch",
			"Dinner",
			"Midnight",
			"Actual",
			"vsPlanPct",
			"vsLYPct",
		]);
		expect(rendered.data.table.rows.map((row) => row.key)).toEqual([
			"Rev",
			"Cover",
			"AveCheck",
		]);
		expect(rendered.data.table.rows[0].cells).toEqual([
			"Rev",
			100,
			200,
			300,
			0,
			600,
			60,
			75,
		]);
		expect(rendered.content).not.toContain("| Plan |");
		expect(rendered.content).not.toContain("Rev(%)");
		expect(rendered.content).toContain("| Rev | 100 | 200 | 300 | 0 | 600 | 60% | 75% |");
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

	it("supports row_sum to build a total row used by row_ratio", () => {
		const block: WorkflowTableBlock = {
			blockId: "row-sum",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "행 합계 계산",
			rows: ["a", "b", "c", "총합", "a_share"],
			columns: ["Q1", "Q2"],
			formulas: [
				"총합 = row_sum(a, b, c)",
				"a_share = row_ratio(a, 총합)",
			],
		};
		const rawContent = JSON.stringify({
			a: { Q1: 10, Q2: 20 },
			b: { Q1: 30, Q2: null },
			c: { Q1: null, Q2: 80 },
		});

		const rendered = service.renderTable(block, rawContent);

		const totalRow = rendered.data.table.rows[3];
		const shareRow = rendered.data.table.rows[4];
		expect(totalRow.key).toBe("총합");
		expect(totalRow.cells).toEqual(["총합", 40, 100]);
		expect(shareRow.key).toBe("a_share");
		expect(shareRow.cells[1]).toBeCloseTo(0.25, 6);
		expect(shareRow.cells[2]).toBeCloseTo(0.2, 6);
	});

	it("rejects row_sum that targets a column or references unknown rows", () => {
		expect(() =>
			service.renderTable(
				{
					blockId: "row-sum-bad-target",
					type: "table",
					layout: "matrix",
					rowHeader: "구분",
					title: "잘못된 row_sum target",
					rows: ["a", "b"],
					columns: ["Q1", "총합"],
					formulas: ["총합 = row_sum(a, b)"],
				},
				JSON.stringify({ a: { Q1: 1 }, b: { Q1: 2 } }),
			),
		).toThrow(/requires a row target/);

		expect(() =>
			service.renderTable(
				{
					blockId: "row-sum-unknown-row",
					type: "table",
					layout: "matrix",
					rowHeader: "구분",
					title: "알 수 없는 row 참조",
					rows: ["a", "b", "총합"],
					columns: ["Q1"],
					formulas: ["총합 = row_sum(a, missing)"],
				},
				JSON.stringify({ a: { Q1: 1 }, b: { Q1: 2 } }),
			),
		).toThrow(/unknown row "missing"/);
	});

	it("computes grand-total cell when col_sum and row_sum intersect", () => {
		const block: WorkflowTableBlock = {
			blockId: "grand-total",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "Category × meal period totals",
			rows: [
				"Food",
				"Food(%)",
				"Beverage",
				"Beverage(%)",
				"Other",
				"Other(%)",
				"Total",
			],
			columns: ["Breakfast", "Lunch", "Dinner", "Midnight", "Actual"],
			formulas: [
				"Actual = sum(Breakfast, Lunch, Dinner, Midnight)",
				"Total = row_sum(Food, Beverage, Other)",
				"Food(%) = row_rate(Food, Total)",
				"Beverage(%) = row_rate(Beverage, Total)",
				"Other(%) = row_rate(Other, Total)",
			],
		};
		const rawContent = JSON.stringify({
			Food: { Breakfast: 10, Lunch: 20, Dinner: 30, Midnight: 0 },
			Beverage: { Breakfast: 5, Lunch: 10, Dinner: 15, Midnight: 0 },
			Other: { Breakfast: 0, Lunch: 5, Dinner: 5, Midnight: 0 },
		});

		const rendered = service.renderTable(block, rawContent);

		const foodPctRow = rendered.data.table.rows[1];
		const totalRow = rendered.data.table.rows[6];

		expect(totalRow.key).toBe("Total");
		expect(totalRow.cells).toEqual(["Total", 15, 35, 50, 0, 100]);

		expect(foodPctRow.key).toBe("Food(%)");
		expect(foodPctRow.cells[5]).toBeCloseTo(60, 6);
	});

	it("supports col_share and col_ratio symmetric to row_share/row_ratio", () => {
		const block: WorkflowTableBlock = {
			blockId: "col-share-ratio",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "Column-direction share & ratio",
			rows: ["Rev", "Cover", "Total"],
			columns: ["Q1", "Q2", "Q1Share", "Q1ToQ2"],
			formulas: [
				"Total = row_sum(Rev, Cover)",
				"Q1Share = col_share(Q1, Total)",
				"Q1ToQ2 = col_ratio(Q1, Q2)",
			],
		};
		const rawContent = JSON.stringify({
			Rev: { Q1: 100, Q2: 200 },
			Cover: { Q1: 50, Q2: 25 },
		});

		const rendered = service.renderTable(block, rawContent);

		const revRow = rendered.data.table.rows[0];
		const coverRow = rendered.data.table.rows[1];
		const totalRow = rendered.data.table.rows[2];

		expect(totalRow.key).toBe("Total");
		expect(totalRow.cells[1]).toBe(150);
		expect(totalRow.cells[2]).toBe(225);
		expect(totalRow.cells[3]).toBeCloseTo(100, 6);
		expect(totalRow.cells[4]).toBeCloseTo(150 / 225, 6);

		expect(revRow.cells[3]).toBeCloseTo((100 / 150) * 100, 6);
		expect(coverRow.cells[3]).toBeCloseTo((50 / 150) * 100, 6);

		expect(revRow.cells[4]).toBeCloseTo(100 / 200, 6);
		expect(coverRow.cells[4]).toBeCloseTo(50 / 25, 6);
	});

	it("legacy share/ratio aliases auto-detect column targets", () => {
		const block: WorkflowTableBlock = {
			blockId: "legacy-col-aliases",
			type: "table",
			layout: "matrix",
			rowHeader: "구분",
			title: "Legacy aliases auto-detect",
			rows: ["Rev", "Cover", "Total"],
			columns: ["Q1", "Q2", "Q1Share"],
			formulas: [
				"Total = row_sum(Rev, Cover)",
				"Q1Share = share(Q1, Total)",
			],
		};
		const rawContent = JSON.stringify({
			Rev: { Q1: 100, Q2: 200 },
			Cover: { Q1: 50, Q2: 25 },
		});

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows[0].cells[3]).toBeCloseTo(
			(100 / 150) * 100,
			6,
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

		const rendered = service.renderTable(
			{
				...recordBlock,
				unit: "KRW",
			},
			rawContent,
		);

		expect(rendered.data.spec).toEqual({
			layout: "records",
			columns: ["store", "grossSales", "refunds", "netSales"],
			formulas: recordBlock.formulas,
			columnFormats: {},
		});
		expect(rendered.data.metadata).toEqual({ unit: "KRW" });
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

	it("hides record columns from output after formulas and totals are evaluated", () => {
		const block: WorkflowTableBlock = {
			...recordBlock,
			blockId: "store-sales-hidden",
			hiddenColumns: ["grossSales", "refunds"],
		};
		const rawContent = JSON.stringify([
			{ store: "Gangnam", grossSales: "1,200,000", refunds: "50,000" },
			{ store: "Hongdae", grossSales: 900000, refunds: 30000 },
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.spec).toMatchObject({
			layout: "records",
			columns: ["store", "netSales"],
			hiddenColumns: ["grossSales", "refunds"],
		});
		expect(rendered.data.table.headers).toEqual(["store", "netSales"]);
		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["Gangnam", 1150000],
			},
			{
				kind: "data",
				cells: ["Hongdae", 870000],
			},
			{
				kind: "total",
				cells: ["Total", 2020000],
			},
		]);
		expect(rendered.content).not.toContain("grossSales");
		expect(rendered.content).not.toContain("refunds");
		expect(rendered.content).toContain("| Gangnam | 1,150,000 |");
	});

	it("treats @Total as the reserved total-row formula", () => {
		const block: WorkflowTableBlock = {
			blockId: "store-sales-total-alias",
			type: "table",
			layout: "records",
			title: "매장별 매출",
			columns: ["store", "grossSales", "refunds", "netSales"],
			formulas: [
				"netSales = grossSales - refunds",
				"@Total = sum(grossSales, refunds, netSales)",
			],
		};
		const rawContent = JSON.stringify([
			{ store: "Gangnam", grossSales: "1,200,000", refunds: "50,000" },
			{ store: "Hongdae", grossSales: 900000, refunds: 30000 },
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows.at(-1)).toEqual({
			kind: "total",
			cells: ["Total", 2100000, 80000, 2020000],
		});
	});

	it("supports sum(*) for record computed columns", () => {
		const block: WorkflowTableBlock = {
			blockId: "department-sales",
			type: "table",
			layout: "records",
			title: "부서별 매출",
			columns: ["store", "breakfast", "lunch", "dinner", "total"],
			formulas: [
				"total = sum(*)",
				"@total = sum(breakfast, lunch, dinner, total)",
			],
		};
		const rawContent = JSON.stringify([
			{ store: "Gangnam", breakfast: 100, lunch: "200", dinner: 300 },
			{ store: "Hongdae", breakfast: null, lunch: 150, dinner: 250 },
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.spec).toEqual({
			layout: "records",
			columns: ["store", "breakfast", "lunch", "dinner", "total"],
			formulas: block.formulas,
			columnFormats: {},
		});
		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["Gangnam", 100, 200, 300, 600],
			},
			{
				kind: "data",
				cells: ["Hongdae", null, 150, 250, 400],
			},
			{
				kind: "total",
				cells: ["Total", 100, 350, 550, 1000],
			},
		]);
		expect(rendered.content).toContain(
			"| Gangnam | 100 | 200 | 300 | 600 |",
		);
	});

	it("supports chained record expressions with multiple operators", () => {
		const block: WorkflowTableBlock = {
			blockId: "multi-operator-records",
			type: "table",
			layout: "records",
			title: "복합 계산",
			columns: ["store", "a", "b", "c", "d", "e", "total"],
			formulas: ["total = a + b + c - d + e"],
		};
		const rawContent = JSON.stringify([
			{ store: "Gangnam", a: 100, b: 50, c: 25, d: 10, e: 5 },
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["Gangnam", 100, 50, 25, 10, 5, 170],
			},
		]);
		expect(rendered.content).toContain(
			"| Gangnam | 100 | 50 | 25 | 10 | 5 | 170 |",
		);
	});

	it("applies standard operator precedence in record expressions", () => {
		const block: WorkflowTableBlock = {
			blockId: "operator-precedence-records",
			type: "table",
			layout: "records",
			title: "연산자 우선순위",
			columns: ["store", "a", "b", "c", "d", "e", "result"],
			formulas: ["result = a + b * c - d / e"],
		};
		const rawContent = JSON.stringify([
			{ store: "Gangnam", a: 10, b: 5, c: 4, d: 18, e: 3 },
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["Gangnam", 10, 5, 4, 18, 3, 24],
			},
		]);
	});

	it("supports numeric literals in record expressions", () => {
		const block: WorkflowTableBlock = {
			blockId: "var-pct-records",
			type: "table",
			layout: "records",
			title: "고객수 변동",
			columns: [
				"구분",
				"2026 고객수",
				"2025 고객수",
				"Var.(명)",
				"Var.(명%)",
			],
			formulas: [
				"Var.(명) = 2026 고객수 - 2025 고객수",
				"Var.(명%) = 2026 고객수 / 2025 고객수 * 100",
			],
		};
		const rawContent = JSON.stringify([
			{
				구분: "A",
				"2026 고객수": 1300,
				"2025 고객수": 1000,
			},
		]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: ["A", 1300, 1000, 300, 130],
			},
		]);
	});

	it("prefers column references when a numeric-shaped column collides with a literal", () => {
		const block: WorkflowTableBlock = {
			blockId: "numeric-column-name",
			type: "table",
			layout: "records",
			title: "숫자 이름 컬럼",
			columns: ["store", "100", "result"],
			formulas: ["result = 100 + store"],
		};
		const rawContent = JSON.stringify([{ store: 5, "100": 42 }]);

		const rendered = service.renderTable(block, rawContent);

		expect(rendered.data.table.rows).toEqual([
			{
				kind: "data",
				cells: [5, 42, 47],
			},
		]);
	});

	it("rejects record formulas that depend on later formulas", () => {
		const block: WorkflowTableBlock = {
			blockId: "record-formula-order",
			type: "table",
			layout: "records",
			title: "Formula order",
			columns: ["a", "b", "c", "d"],
			formulas: ["d = c / b + a", "c = a + b"],
		};
		const rawContent = JSON.stringify([{ a: 10, b: 5 }]);

		expect(() => service.renderTable(block, rawContent)).toThrow(
			'Record formula "d = c / b + a" depends on values from later formulas: c',
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

	it("preserves source decimal precision when decimals are unspecified", () => {
		const turnoverBlock: WorkflowTableBlock = {
			blockId: "turnover",
			type: "table",
			layout: "records",
			title: "회전율",
			columns: ["구분", "빌수(건)", "회전율(회)"],
		};
		const rawContent = JSON.stringify([
			{ 구분: "주중", "빌수(건)": 238, "회전율(회)": 14.88 },
			{ 구분: "주말", "빌수(건)": "5,543", "회전율(회)": "13.81" },
		]);

		const rendered = service.renderTable(turnoverBlock, rawContent);

		expect(rendered.content).toContain("| 주중 | 238 | 14.88 |");
		expect(rendered.content).toContain("| 주말 | 5,543 | 13.81 |");
	});

	it("caps unspecified decimals at 4 digits for computed float noise", () => {
		const ratioBlock: WorkflowTableBlock = {
			blockId: "ratio",
			type: "table",
			layout: "records",
			title: "비율",
			columns: ["구분", "a", "b", "ratio"],
			formulas: ["ratio = a / b"],
		};
		const rawContent = JSON.stringify([{ 구분: "주중", a: 100, b: 3 }]);

		const rendered = service.renderTable(ratioBlock, rawContent);

		expect(rendered.content).toContain("| 주중 | 100 | 3 | 33.3333 |");
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

	it("omits sum(*) targets from record extraction prompts", () => {
		const block: WorkflowTableBlock = {
			blockId: "department-sales",
			type: "table",
			layout: "records",
			title: "부서별 매출",
			columns: ["store", "breakfast", "lunch", "dinner", "total"],
			formulas: ["total = sum(*)"],
		};

		const prompt = service.buildExtractionPrompt(
			block,
			"[task-4] Department Sales\nStatus: completed\nResult:\n...",
		);
		const extractionSection = prompt.split(
			"Formulas for later calculation:",
		)[0];

		expect(extractionSection).toContain(
			"Columns to extract:\n- store\n- breakfast\n- lunch\n- dinner",
		);
		expect(extractionSection).not.toContain("- total");
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
