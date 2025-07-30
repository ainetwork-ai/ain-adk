export interface Intent {
	name: string;
	description: string;
}

export interface IntentRepository {
	getIntent(name: string): Promise<Intent | null>;
	getIntents(): Promise<Array<Intent>>;
	saveIntent(intent: Intent): Promise<void>;
	deleteIntent(name: string): Promise<void>;
	updateIntent(intent: Intent): Promise<void>;
}
