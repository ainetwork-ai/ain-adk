import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import type {
	CalculatorOperation,
	CalculatorOptions,
	CalculatorRequest,
	CalculatorResult,
	CalculatorRoundingMode,
	NumericOperand,
} from "@/types/numeric.js";

type ParsedDecimal = {
	value: bigint;
	scale: number;
};

const BUILTIN_CALCULATOR_TOOL = "builtin_calculator";
const BUILTIN_CONNECTOR_NAME = "builtin";

export class CalculatorService {
	private options: Required<CalculatorOptions>;

	constructor(options?: CalculatorOptions) {
		this.options = {
			enabled: options?.enabled ?? false,
			exposeAsTool: options?.exposeAsTool ?? true,
			defaultScale: options?.defaultScale ?? 4,
			roundingMode: options?.roundingMode ?? "half_up",
		};
	}

	public isEnabled(): boolean {
		return this.options.enabled;
	}

	public isToolAvailable(): boolean {
		return this.options.enabled && this.options.exposeAsTool;
	}

	public getTools(prompt: string): ConnectorTool[] {
		if (!this.isToolAvailable()) {
			return [];
		}

		return [
			{
				toolName: BUILTIN_CALCULATOR_TOOL,
				connectorName: BUILTIN_CONNECTOR_NAME,
				protocol: CONNECTOR_PROTOCOL_TYPE.BUILTIN,
				description:
					"Deterministic decimal-safe arithmetic for add, subtract, multiply, and divide.",
				inputSchema: {
					type: "object",
					properties: {
						thinking_text: {
							type: "string",
							description: prompt,
						},
						operation: {
							type: "string",
							enum: ["add", "subtract", "multiply", "divide"],
						},
						operands: {
							type: "array",
							items: {
								anyOf: [{ type: "string" }, { type: "number" }],
							},
							minItems: 2,
						},
						scale: {
							type: "integer",
							minimum: 0,
						},
						roundingMode: {
							type: "string",
							enum: ["half_up", "down", "half_even"],
						},
					},
					required: ["thinking_text", "operation", "operands"],
				},
			},
		];
	}

	public calculate(request: CalculatorRequest): CalculatorResult {
		const roundingMode =
			request.roundingMode ?? this.options.roundingMode ?? "half_up";
		let normalizedOperands: string[] = [];

		try {
			normalizedOperands = request.operands.map((operand) =>
				this.normalizeOperand(operand),
			);
			if (normalizedOperands.length < 2) {
				return {
					ok: false,
					operation: request.operation,
					operands: normalizedOperands,
					error: "At least two operands are required.",
					scale: request.scale ?? this.options.defaultScale,
					roundingMode,
				};
			}

			const parsedOperands = normalizedOperands.map((operand) =>
				this.parseDecimal(operand),
			);
			const result = this.executeOperation(
				request.operation,
				parsedOperands,
				request.scale,
				roundingMode,
			);

			return {
				ok: true,
				operation: request.operation,
				operands: normalizedOperands,
				result,
				scale: this.getReportedScale(result),
				roundingMode,
			};
		} catch (error) {
			return {
				ok: false,
				operation: request.operation,
				operands: normalizedOperands,
				error:
					error instanceof Error
						? error.message
						: "Calculator execution failed.",
				scale: request.scale ?? this.options.defaultScale,
				roundingMode,
			};
		}
	}

	public useTool(tool: ConnectorTool, args?: Record<string, unknown>): string {
		if (tool.toolName !== BUILTIN_CALCULATOR_TOOL) {
			return `[Bot Called Tool ${tool.toolName} with args ${JSON.stringify(args ?? {})}]\n${JSON.stringify(
				{
					ok: false,
					error: "Unknown built-in calculator tool.",
				},
				null,
				2,
			)}`;
		}

		const request = this.parseToolRequest(args);
		const result = this.calculate(request);

		return `[Bot Called Tool ${tool.toolName} with args ${JSON.stringify(args ?? {})}]\n${JSON.stringify(
			result,
			null,
			2,
		)}`;
	}

	private parseToolRequest(args?: Record<string, unknown>): CalculatorRequest {
		return {
			operation: String(args?.operation ?? "") as CalculatorOperation,
			operands: Array.isArray(args?.operands)
				? (args?.operands as NumericOperand[])
				: [],
			scale:
				typeof args?.scale === "number"
					? args.scale
					: typeof args?.scale === "string"
						? Number.parseInt(args.scale, 10)
						: undefined,
			roundingMode:
				typeof args?.roundingMode === "string"
					? (args.roundingMode as CalculatorRoundingMode)
					: undefined,
		};
	}

	private executeOperation(
		operation: CalculatorOperation,
		operands: ParsedDecimal[],
		scale: number | undefined,
		roundingMode: CalculatorRoundingMode,
	): string {
		switch (operation) {
			case "add":
				return this.formatDecimal(
					this.addAll(operands, scale, roundingMode),
					scale !== undefined,
				);
			case "subtract":
				return this.formatDecimal(
					this.subtractAll(operands, scale, roundingMode),
					scale !== undefined,
				);
			case "multiply":
				return this.formatDecimal(
					this.multiplyAll(operands, scale, roundingMode),
					scale !== undefined,
				);
			case "divide":
				return this.formatDecimal(
					this.divideAll(operands, scale, roundingMode),
					true,
				);
			default:
				throw new Error(`Unsupported operation: ${operation}`);
		}
	}

	private addAll(
		operands: ParsedDecimal[],
		scale: number | undefined,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		const commonScale = Math.max(...operands.map((operand) => operand.scale));
		const summed = operands.reduce<ParsedDecimal>(
			(acc, operand) => this.addDecimals(acc, operand),
			{ value: 0n, scale: commonScale },
		);

		return scale === undefined
			? this.trimScale(summed)
			: this.rescaleDecimal(summed, scale, roundingMode);
	}

	private subtractAll(
		operands: ParsedDecimal[],
		scale: number | undefined,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		const [first, ...rest] = operands;
		if (!first) {
			throw new Error("At least one operand is required.");
		}

		const result = rest.reduce<ParsedDecimal>(
			(acc, operand) => this.subtractDecimals(acc, operand),
			first,
		);

		return scale === undefined
			? this.trimScale(result)
			: this.rescaleDecimal(result, scale, roundingMode);
	}

	private multiplyAll(
		operands: ParsedDecimal[],
		scale: number | undefined,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		const [first, ...rest] = operands;
		if (!first) {
			throw new Error("At least one operand is required.");
		}

		const result = rest.reduce<ParsedDecimal>(
			(acc, operand) => this.multiplyDecimals(acc, operand),
			first,
		);

		return scale === undefined
			? this.trimScale(result)
			: this.rescaleDecimal(result, scale, roundingMode);
	}

	private divideAll(
		operands: ParsedDecimal[],
		scale: number | undefined,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		const [first, ...rest] = operands;
		if (!first) {
			throw new Error("At least one operand is required.");
		}

		const targetScale = scale ?? this.options.defaultScale;

		return rest.reduce<ParsedDecimal>(
			(acc, operand) =>
				this.divideDecimals(acc, operand, targetScale, roundingMode),
			first,
		);
	}

	private addDecimals(
		left: ParsedDecimal,
		right: ParsedDecimal,
	): ParsedDecimal {
		const commonScale = Math.max(left.scale, right.scale);
		const leftValue = this.alignScale(left, commonScale);
		const rightValue = this.alignScale(right, commonScale);

		return { value: leftValue + rightValue, scale: commonScale };
	}

	private subtractDecimals(
		left: ParsedDecimal,
		right: ParsedDecimal,
	): ParsedDecimal {
		const commonScale = Math.max(left.scale, right.scale);
		const leftValue = this.alignScale(left, commonScale);
		const rightValue = this.alignScale(right, commonScale);

		return { value: leftValue - rightValue, scale: commonScale };
	}

	private multiplyDecimals(
		left: ParsedDecimal,
		right: ParsedDecimal,
	): ParsedDecimal {
		return {
			value: left.value * right.value,
			scale: left.scale + right.scale,
		};
	}

	private divideDecimals(
		numerator: ParsedDecimal,
		denominator: ParsedDecimal,
		targetScale: number,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		if (denominator.value === 0n) {
			throw new Error("Division by zero is not allowed.");
		}

		const numeratorAbs = this.absolute(numerator.value);
		const denominatorAbs = this.absolute(denominator.value);
		const exponent = targetScale + denominator.scale - numerator.scale;

		let scaledNumerator = numeratorAbs;
		let scaledDenominator = denominatorAbs;

		if (exponent >= 0) {
			scaledNumerator *= this.powerOfTen(exponent);
		} else {
			scaledDenominator *= this.powerOfTen(-exponent);
		}

		let quotient = scaledNumerator / scaledDenominator;
		const remainder = scaledNumerator % scaledDenominator;

		if (
			this.shouldRoundUp(quotient, remainder, scaledDenominator, roundingMode)
		) {
			quotient += 1n;
		}

		const sign = numerator.value < 0n !== denominator.value < 0n ? -1n : 1n;
		return {
			value: quotient * sign,
			scale: targetScale,
		};
	}

	private shouldRoundUp(
		quotient: bigint,
		remainder: bigint,
		divisor: bigint,
		mode: CalculatorRoundingMode,
	): boolean {
		if (remainder === 0n || mode === "down") {
			return false;
		}

		const doubledRemainder = remainder * 2n;
		if (mode === "half_up") {
			return doubledRemainder >= divisor;
		}

		if (doubledRemainder > divisor) {
			return true;
		}
		if (doubledRemainder < divisor) {
			return false;
		}

		return quotient % 2n !== 0n;
	}

	private rescaleDecimal(
		value: ParsedDecimal,
		targetScale: number,
		roundingMode: CalculatorRoundingMode,
	): ParsedDecimal {
		if (targetScale === value.scale) {
			return value;
		}

		if (targetScale > value.scale) {
			return {
				value: value.value * this.powerOfTen(targetScale - value.scale),
				scale: targetScale,
			};
		}

		const factor = this.powerOfTen(value.scale - targetScale);
		const absoluteValue = this.absolute(value.value);
		let quotient = absoluteValue / factor;
		const remainder = absoluteValue % factor;

		if (this.shouldRoundUp(quotient, remainder, factor, roundingMode)) {
			quotient += 1n;
		}

		return {
			value: value.value < 0n ? -quotient : quotient,
			scale: targetScale,
		};
	}

	private trimScale(value: ParsedDecimal): ParsedDecimal {
		let currentValue = value.value;
		let currentScale = value.scale;

		while (currentScale > 0 && currentValue % 10n === 0n) {
			currentValue /= 10n;
			currentScale -= 1;
		}

		return {
			value: currentValue,
			scale: currentScale,
		};
	}

	private alignScale(value: ParsedDecimal, targetScale: number): bigint {
		if (value.scale === targetScale) {
			return value.value;
		}

		return value.value * this.powerOfTen(targetScale - value.scale);
	}

	private parseDecimal(input: string): ParsedDecimal {
		const normalized = input.trim();
		if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(normalized)) {
			throw new Error(`Invalid numeric operand: ${input}`);
		}

		const sign = normalized.startsWith("-") ? -1n : 1n;
		const unsigned = normalized.replace(/^[-+]/, "");
		const [integerPart, fractionalPart = ""] = unsigned.split(".");
		const digits = `${integerPart || "0"}${fractionalPart}`.replace(
			/^0+(?=\d)/,
			"",
		);
		const value = BigInt(digits || "0") * sign;

		return {
			value,
			scale: fractionalPart.length,
		};
	}

	private formatDecimal(value: ParsedDecimal, preserveScale: boolean): string {
		const normalized = preserveScale ? value : this.trimScale(value);
		const absoluteDigits = this.absolute(normalized.value).toString();
		const sign = normalized.value < 0n ? "-" : "";

		if (normalized.scale === 0) {
			return `${sign}${absoluteDigits}`;
		}

		const padded = absoluteDigits.padStart(normalized.scale + 1, "0");
		const integerPart = padded.slice(0, -normalized.scale);
		const fractionalPart = padded.slice(-normalized.scale);

		return `${sign}${integerPart}.${fractionalPart}`;
	}

	private normalizeOperand(operand: NumericOperand): string {
		if (typeof operand === "number") {
			if (!Number.isFinite(operand)) {
				throw new Error("Numeric operand must be finite.");
			}
			return operand.toString();
		}

		return operand.trim();
	}

	private powerOfTen(exponent: number): bigint {
		return 10n ** BigInt(exponent);
	}

	private absolute(value: bigint): bigint {
		return value < 0n ? -value : value;
	}

	private getReportedScale(result: string): number {
		const [, fractionalPart = ""] = result.split(".");
		return fractionalPart.length;
	}
}
