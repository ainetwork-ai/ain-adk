import type { A2AClient, AgentCard } from "@a2a-js/sdk";
import { AgentTool } from "../common/tool.js";
import { PROTOCOL_TYPE } from "../common/types.js";

export class A2ATool extends AgentTool {
	public client: A2AClient;
	public card: AgentCard;

	constructor(name: string, client: A2AClient, card: AgentCard) {
		super(name, PROTOCOL_TYPE.A2A);
		this.client = client;
		this.card = card;
	}
}
