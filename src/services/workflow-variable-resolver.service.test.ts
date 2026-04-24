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
});
