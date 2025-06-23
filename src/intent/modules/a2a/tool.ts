import type { A2AClient } from "@a2a-js/sdk";
import { AgentTool } from "../common/tool.js";
import { PROTOCOL_TYPE } from "../common/types.js";

export class A2ATool extends AgentTool {
	public client: A2AClient;

	constructor(name: string, client: A2AClient) {
		super(name, PROTOCOL_TYPE.A2A);
		this.client = client;
	}
}
