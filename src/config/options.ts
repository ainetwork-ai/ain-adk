import type { AgentOptions } from "@/types/agent";
import type { CalculatorOptions } from "@/types/numeric";

let _options: AgentOptions | null = null;

export function setOptions(options: AgentOptions): void {
	_options = options;
}

export function getOptions(): AgentOptions {
	if (!_options) {
		throw new Error("Options not initialized. AINAgent must be created first.");
	}
	return _options;
}

export function getOnIntentFallback(): AgentOptions["onIntentFallback"] {
	return getOptions().onIntentFallback;
}

export function getCalculatorOptions(): CalculatorOptions | undefined {
	return getOptions().calculator;
}
