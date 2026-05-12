import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";
import { AinHttpError } from "@/types/agent";
import type { WorkflowDefinition } from "@/types/memory";

describe("WorkflowVariableResolver", () => {
	it("resolves workflow execution input as text-first query data", () => {
		const resolver = new WorkflowVariableResolver();

		const result = resolver.resolveForExecution(
			{
				title: "Daily summary for {{workspace}}",
				content: "Summarize {{workspace}} performance",
				timezone: "Asia/Seoul",
				variables: {
					workspace: {
						id: "workspace",
						label: "Workspace",
						type: "text",
						resolveAt: "execution",
					},
				},
				variableValues: {},
			},
			{ workspace: "AIN" },
		);

		expect(result).toEqual({
			query: "Summarize AIN performance",
			displayQuery: "Daily summary for AIN",
			definition: undefined,
		});
		expect("input" in result).toBe(false);
	});

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

	it("keeps graph blocks with supported Mermaid graph types unchanged", () => {
		const resolver = new WorkflowVariableResolver();
		const definition: WorkflowDefinition = {
			tasks: [],
			response: {
				blocks: [
					{
						blockId: "monthly-sales-graph",
						type: "graph",
						graphType: "xychart-beta",
						title: "월별 매출 및 계획비 비교",
						prompt: "월별 실적과 계획을 x축 월 기준으로 정리한다.",
						sourceTaskIds: ["sales-task"],
					},
					{
						blockId: "sales-share-graph",
						type: "graph",
						graphType: "pie",
						title: "매출 비중",
						showData: true,
						prompt: "카테고리별 매출 비중을 정리한다.",
					},
				],
			},
		};

		expect(resolver.normalizeDefinition(definition)).toEqual(definition);
	});

	it("rejects graph blocks with unsupported graph types", () => {
		const resolver = new WorkflowVariableResolver();
		const definition = {
			tasks: [],
			response: {
				blocks: [
					{
						blockId: "bad-graph",
						type: "graph",
						graphType: "line",
						prompt: "그래프를 만든다.",
					},
				],
			},
		} as unknown as WorkflowDefinition;

		expect(() => resolver.normalizeDefinition(definition)).toThrow(
			'Graph block "bad-graph" must declare graphType as "xychart-beta" or "pie".',
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

	it("replaces workflow variable offsets inside table rows and columns", () => {
		const resolver = new WorkflowVariableResolver();

		const result = resolver.resolveForExecution({
			title: "{{년도}}년 비교 리포트",
			content: "{{년도}} vs {{년도-1}}",
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
				tasks: [],
				response: {
					blocks: [
						{
							blockId: "sales-compare",
							type: "table",
							layout: "matrix",
							rowHeader: "구분",
							rows: ["{{년도}} 실적", "{{년도-1}} 실적", "{{월+1}}월 목표"],
							columns: ["{{년도}}", "{{년도-1}}", "{{월-1}}월"],
						},
					],
				},
			},
		});

		const tableBlock = result.definition?.response.blocks[0];
		if (!tableBlock || tableBlock.type !== "table") {
			throw new Error("Expected a table block");
		}

		expect(tableBlock.rows).toEqual(["2026 실적", "2025 실적", "05월 목표"]);
		expect(tableBlock.columns).toEqual(["2026", "2025", "03월"]);
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
