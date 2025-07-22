export type AinAgentPrompts = {
	agent?: string;
	system?: string;
};

export type AinAgentManifest = {
	name: string;
	description: string;
	version: string;
	url?: string;
	prompts?: AinAgentPrompts;
};
