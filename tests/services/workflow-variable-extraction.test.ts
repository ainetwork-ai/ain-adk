import type { ModelModule } from "@/modules";
import { WorkflowVariableExtractionService } from "@/services/workflow-variable-extraction.service";
import type { WorkflowVariable } from "@/types/memory";

const VARIABLES: Record<string, WorkflowVariable> = {
	workplace: {
		id: "workplace",
		label: "분석할 업장을 선택해주세요",
		type: "dropdown",
		options: ["강남점", "판교점"],
	},
	period: {
		id: "period",
		label: "분석 기간",
		type: "date_range",
		resolveAt: "execution",
	},
};

function build(fetchResult: { content?: string } | Error) {
	const fetch = jest.fn(async () => {
		if (fetchResult instanceof Error) {
			throw fetchResult;
		}
		return fetchResult;
	});
	const generateMessages = jest.fn(() => [{ role: "user" }]);
	const modelModule = {
		getModel: () => ({ generateMessages, fetch }),
		getModelOptions: () => ({}),
	} as unknown as ModelModule;
	const service = new WorkflowVariableExtractionService(modelModule);
	return { service, fetch, generateMessages };
}

describe("extractFromQuery", () => {
	it("returns values the model extracted for declared variables", async () => {
		const { service } = build({
			content: JSON.stringify({
				workplace: "강남점",
				period: "2026-07-20 ~ 2026-07-26",
			}),
		});
		await expect(
			service.extractFromQuery(VARIABLES, "지난주 강남점 매출 분석해줘"),
		).resolves.toEqual({
			workplace: "강남점",
			period: "2026-07-20 ~ 2026-07-26",
		});
	});

	it("drops dropdown values that are not in options and unknown keys", async () => {
		const { service } = build({
			content: JSON.stringify({
				workplace: "없는지점",
				period: "2026-07-20 ~ 2026-07-26",
				hallucinated: "값",
			}),
		});
		await expect(
			service.extractFromQuery(VARIABLES, "지난주 매출 분석해줘"),
		).resolves.toEqual({ period: "2026-07-20 ~ 2026-07-26" });
	});

	it("accepts built-in template tokens for relative dates", async () => {
		const { service } = build({
			content: JSON.stringify({
				period: "{{today-7}} ~ {{yesterday}}",
			}),
		});
		await expect(
			service.extractFromQuery(VARIABLES, "지난 일주일 매출 분석해줘"),
		).resolves.toEqual({ period: "{{today-7}} ~ {{yesterday}}" });
	});

	it("drops values containing unknown template tokens", async () => {
		const { service } = build({
			content: JSON.stringify({
				period: "{{lastWeekStart}} ~ {{lastWeekEnd}}",
			}),
		});
		await expect(
			service.extractFromQuery(VARIABLES, "지난주 매출 분석해줘"),
		).resolves.toBeUndefined();
	});

	it("returns undefined when the model extracts nothing usable", async () => {
		const { service } = build({ content: JSON.stringify({}) });
		await expect(
			service.extractFromQuery(VARIABLES, "매출 분석해줘"),
		).resolves.toBeUndefined();
	});

	it("fails open on invalid JSON", async () => {
		const { service } = build({ content: "죄송하지만 JSON이 아닙니다" });
		await expect(
			service.extractFromQuery(VARIABLES, "매출 분석해줘"),
		).resolves.toBeUndefined();
	});

	it("fails open on model errors", async () => {
		const { service } = build(new Error("rate limited"));
		await expect(
			service.extractFromQuery(VARIABLES, "매출 분석해줘"),
		).resolves.toBeUndefined();
	});

	it("skips the model call entirely when there are no variables", async () => {
		const { service, fetch } = build({ content: "{}" });
		await expect(service.extractFromQuery({}, "매출 분석해줘")).resolves
			.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fails open on malformed variable spec (options not array)", async () => {
		const { service, fetch } = build({ content: "{}" });
		const malformed = {
			bad: {
				id: "bad",
				label: "업장",
				type: "dropdown",
				options: "강남점",
			} as never,
		};
		await expect(
			service.extractFromQuery(malformed, "매출 분석해줘"),
		).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});
});
