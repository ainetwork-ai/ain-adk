export type CalculatorRoundingMode = "half_up" | "down" | "half_even";

export type CalculatorOperation = "add" | "subtract" | "multiply" | "divide";

export type NumericOperand = string | number;

export type CalculatorOptions = {
	enabled?: boolean;
	exposeAsTool?: boolean;
	defaultScale?: number;
	roundingMode?: CalculatorRoundingMode;
};

export type CalculatorRequest = {
	operation: CalculatorOperation;
	operands: NumericOperand[];
	scale?: number;
	roundingMode?: CalculatorRoundingMode;
};

export type CalculatorResult = {
	ok: boolean;
	operation: CalculatorOperation;
	operands: string[];
	result?: string;
	error?: string;
	scale: number;
	roundingMode: CalculatorRoundingMode;
};
