import type { OnIntentFallback, OnIntentFulfill } from "@/types/agent";

export interface AgentOptions {
	onIntentFallback?: OnIntentFallback;
	onIntentFulfill?: OnIntentFulfill;
	intentMode?: "single" | "multi";
}

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

export function getOnIntentFallback(): OnIntentFallback | undefined {
	return getOptions().onIntentFallback;
}
export function getOnIntentFulfill(): OnIntentFulfill | undefined {
	return getOptions().onIntentFulfill;
}
