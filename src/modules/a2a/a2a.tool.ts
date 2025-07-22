import type { A2AClient, AgentCard } from "@a2a-js/sdk";
import { type IA2ATool, TOOL_PROTOCOL_TYPE } from "@/types/tool.js";

export class A2ATool implements IA2ATool {
	public id: string;
	public protocol: TOOL_PROTOCOL_TYPE;
	public enabled: boolean;
	public client: A2AClient;
	public card: AgentCard;

	constructor(name: string, client: A2AClient, card: AgentCard) {
		this.id = name;
		this.protocol = TOOL_PROTOCOL_TYPE.A2A;
		this.enabled = true;
		this.client = client;
		this.card = card;
	}

	public enable(): void {
		this.enabled = true;
	}

	public disable(): void {
		this.enabled = false;
	}
}
