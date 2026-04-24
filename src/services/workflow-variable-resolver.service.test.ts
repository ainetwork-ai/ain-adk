import { AinHttpError } from "../types/agent";
import type { WorkflowDefinition } from "../types/memory";
import { WorkflowVariableResolver } from "./workflow-variable-resolver.service";

describe("WorkflowVariableResolver", () => {
	it("keeps current table DSL definitions unchanged", () => {
		const resolver = new WorkflowVariableResolver();
		const definition: WorkflowDefinition = {
			tasks: [],
			response: {
				blocks: [
					{
						blockId: "daily-sales",
						type: "table",
						layout: "matrix",
						rowHeader: "구분",
						rows: ["Rev", "Cover"],
						columns: ["Lunch", "Dinner", "Actual"],
						formulas: ["Actual = sum(Lunch, Dinner)"],
					},
				],
			},
		};

		expect(resolver.normalizeDefinition(definition)).toEqual(definition);
	});

	it("rejects legacy table blocks without layout", () => {
		const resolver = new WorkflowVariableResolver();
		const definition = {
			tasks: [],
			response: {
				blocks: [
					{
						blockId: "legacy-table",
						type: "table",
						title: "Legacy",
						columns: [
							{ key: "store", label: "Store" },
							{ key: "grossSales", label: "Gross Sales" },
						],
					},
				],
			},
		} as unknown as WorkflowDefinition;

		expect(() => resolver.normalizeDefinition(definition)).toThrow(
			AinHttpError,
		);
		expect(() => resolver.normalizeDefinition(definition)).toThrow(
			'Table block "legacy-table" must declare layout as "records" or "matrix".',
		);
	});

	it("applies stored execution-time variableValues and lets executionVariables override them", () => {
		const resolver = new WorkflowVariableResolver();

		const result = resolver.resolveForExecution(
			{
				title: "리포트 {{target_date}}",
				content: "일자 {{target_date}} / 매장 {{store_id}}",
				timezone: "Asia/Seoul",
				variables: {
					target_date: {
						id: "target_date",
						label: "기준일",
						type: "text",
						resolveAt: "execution",
					},
					store_id: {
						id: "store_id",
						label: "매장",
						type: "text",
						resolveAt: "execution",
					},
				},
				variableValues: {
					target_date: "{{today}}",
					store_id: "gangnam",
				},
				definition: {
					tasks: [
						{
							taskId: "fetch",
							title: "조회",
							prompt: "날짜 {{target_date}} / 매장 {{store_id}}",
						},
					],
					response: {
						blocks: [],
					},
				},
			},
			{
				store_id: "hongdae",
			},
		);

		expect(result.displayQuery).toMatch(/^리포트 \d{4}-\d{2}-\d{2}$/);
		expect(result.query).toMatch(/^일자 \d{4}-\d{2}-\d{2} \/ 매장 hongdae$/);
		expect(result.definition?.tasks[0].prompt).toMatch(
			/^날짜 \d{4}-\d{2}-\d{2} \/ 매장 hongdae$/,
		);
	});

	it("replaces placeholders by variable id as well as variable key", () => {
		const resolver = new WorkflowVariableResolver();

		const result = resolver.resolveForExecution({
			title: "{{년도}}년 {{월}}월 리포트",
			content: "기간={{년도}}-{{월}}",
			timezone: "Asia/Seoul",
			variables: {
				year: {
					id: "년도",
					label: "년도",
					type: "text",
					resolveAt: "execution",
				},
				month: {
					id: "월",
					label: "월",
					type: "text",
					resolveAt: "execution",
				},
			},
			variableValues: {
				year: "2026",
				month: "04",
			},
			definition: {
				tasks: [
					{
						taskId: "fetch",
						title: "조회",
						prompt: "{{년도}}년 {{월}}월 데이터 조회",
					},
				],
				response: {
					blocks: [],
				},
			},
		});

		expect(result.displayQuery).toBe("2026년 04월 리포트");
		expect(result.query).toBe("기간=2026-04");
		expect(result.definition?.tasks[0].prompt).toBe("2026년 04월 데이터 조회");
	});

	it("expands date_parts variables through parts mappings", () => {
		const resolver = new WorkflowVariableResolver();

		const result = resolver.resolveForExecution({
			title: "{{년도}}년 {{월}}월 리포트",
			content: "기간={{년도}}-{{월}} / 일자={{일}}",
			timezone: "Asia/Seoul",
			variables: {
				report_date: {
					id: "report_date",
					label: "기준일",
					type: "date_parts",
					resolveAt: "execution",
					parts: {
						year: "년도",
						month: "월",
						day: "일",
					},
				},
			},
			variableValues: {
				report_date: "2026-04-23",
			},
			definition: {
				tasks: [
					{
						taskId: "fetch",
						title: "조회",
						prompt: "{{년도}}년 {{월}}월 {{일}}일 데이터 조회",
					},
				],
				response: {
					blocks: [],
				},
			},
		});

		expect(result.displayQuery).toBe("2026년 04월 리포트");
		expect(result.query).toBe("기간=2026-04 / 일자=23");
		expect(result.definition?.tasks[0].prompt).toBe(
			"2026년 04월 23일 데이터 조회",
		);
	});

	it("accepts dropdown as an alias for select", () => {
		const resolver = new WorkflowVariableResolver();

		expect(
			resolver.normalizeVariables({
				store: {
					id: "store",
					label: "업장",
					type: "dropdown",
					options: ["A", "B"],
				},
			}),
		).toEqual({
			store: {
				id: "store",
				label: "업장",
				type: "select",
				options: ["A", "B"],
			},
		});
	});
});
