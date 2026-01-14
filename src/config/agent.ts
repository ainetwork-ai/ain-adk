import type { AINAgent } from "@/index";

let _agent: AINAgent | null = null;

export function setAgent(agent: AINAgent): void {
	_agent = agent;
}

export function getAgent(): AINAgent {
	if (!_agent) {
		throw new Error("Agent not initialized. AINAgent must be created first.");
	}
	return _agent;
}
