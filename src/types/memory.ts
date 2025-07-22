export enum ChatRole {
	USER = "USER",
	SYSTEM = "SYSTEM",
	MODEL = "MODEL",
}

export type ChatContentObject = {
	type: string;
	parts: any[];
};

export type ChatObject = {
	role: ChatRole;
	content: ChatContentObject;
	timestamp: number;
	metadata?: { [key: string]: unknown };
};

export type SessionObject = {
	[messageId: string]: ChatObject;
};
