import { CalculatorService } from "./calculator.service";

describe("CalculatorService", () => {
	it("keeps decimal addition exact", () => {
		const service = new CalculatorService({ enabled: true });

		const result = service.calculate({
			operation: "add",
			operands: ["0.1", "0.2"],
		});

		expect(result).toMatchObject({
			ok: true,
			result: "0.3",
		});
	});

	it("supports chained subtraction", () => {
		const service = new CalculatorService({ enabled: true });

		const result = service.calculate({
			operation: "subtract",
			operands: ["10", "3", "2.5"],
		});

		expect(result).toMatchObject({
			ok: true,
			result: "4.5",
		});
	});

	it("supports exact multiplication", () => {
		const service = new CalculatorService({ enabled: true });

		const result = service.calculate({
			operation: "multiply",
			operands: ["1.25", "4"],
		});

		expect(result).toMatchObject({
			ok: true,
			result: "5",
		});
	});

	it("applies deterministic division scale", () => {
		const service = new CalculatorService({ enabled: true, defaultScale: 4 });

		const result = service.calculate({
			operation: "divide",
			operands: ["1", "3"],
		});

		expect(result).toMatchObject({
			ok: true,
			result: "0.3333",
			scale: 4,
		});
	});

	it("rejects division by zero", () => {
		const service = new CalculatorService({ enabled: true });

		const result = service.calculate({
			operation: "divide",
			operands: ["10", "0"],
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Division by zero");
	});

	it("exposes the tool only when enabled", () => {
		const disabledService = new CalculatorService();
		const enabledService = new CalculatorService({ enabled: true });

		expect(disabledService.getTools("reason")).toHaveLength(0);
		expect(enabledService.getTools("reason")).toHaveLength(1);
	});
});
