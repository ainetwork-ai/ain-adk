export enum ChatRole {
	USER = "USER",
	SYSTEM = "SYSTEM",
	MODEL = "MODEL",
}

export type ContentObject = {
	type: string;
	parts: any[];
};

export type MessageObject = {
	role: ChatRole;
	content: ContentObject;
	metadata?: any;
};

export type SessionObject = {
	[messageId: string]: MessageObject;
};

export abstract class BaseSession {
	abstract getSessionHistory(sessionId: string): SessionObject;
}
