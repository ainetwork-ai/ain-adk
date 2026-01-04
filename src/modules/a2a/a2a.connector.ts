import type { Client as A2AClient } from "@a2a-js/sdk/client";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type IAgentConnector,
} from "@/types/connector.js";

export class A2AConnector implements IAgentConnector {
	public name: string;
	public protocol: CONNECTOR_PROTOCOL_TYPE = CONNECTOR_PROTOCOL_TYPE.A2A;
	public enabled: boolean;
	public url: string;
	public client: A2AClient | null = null;

	constructor(name: string, url: string) {
		this.name = name;
		this.enabled = true;
		this.url = url;
	}

	public enable(): void {
		this.enabled = true;
	}

	public disable(): void {
		this.enabled = false;
	}
}
