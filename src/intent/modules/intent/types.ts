export interface ADKIntent {
	id: string;
	name: string;
	description: string;
	triggerSentences: string[];
}

export type Message = {
	role: "system" | "user" | "assistant" | "tool" | "function";
	content:
		| string
		| Array<
				| { type: "text"; text: string }
				| { type: "image_url"; image_url: { url: string } }
		  >;
};

export interface IntentModule {
	getIntents(): Promise<ADKIntent[]>;
	saveIntentTriggeringInfo(info: ADKIntentTriggeringInfo): Promise<void>;
}

export interface ADKIntentTriggeringInfo {
	context: {
		messages: Message[];
	};
	intent: {
		name: string;
		description: string;
	};
}
