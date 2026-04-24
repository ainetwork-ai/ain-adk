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
});
