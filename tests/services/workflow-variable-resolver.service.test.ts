import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";

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
		});
		expect("input" in result).toBe(false);
	});
});
