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
	metadata?: any;
};

export type SessionObject = {
	[messageId: string]: ChatObject;
};
