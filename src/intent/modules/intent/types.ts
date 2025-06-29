export enum PROTOCOL_TYPE {
	A2A = "A2A",
	MCP = "MCP",
}

export interface ADKIntent {
	id: string;
	name: string;
	description: string;
	triggerSentences: string[];
}

export interface IntentModule {
	getIntents(): Promise<ADKIntent[]>;
}
