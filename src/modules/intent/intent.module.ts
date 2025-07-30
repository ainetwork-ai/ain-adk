import type { Intent, IntentRepository } from "../../types/intent.js";

export class IntentModule {
	private repository: IntentRepository;

	constructor(repository: IntentRepository) {
		this.repository = repository;
	}

	public async getIntent(name: string): Promise<Intent | null> {
		return this.repository.getIntent(name);
	}

	public async getIntents(): Promise<Array<Intent>> {
		return this.repository.getIntents();
	}

	public async saveIntent(name: string, description: string): Promise<void> {
		await this.repository.saveIntent({ name, description });
	}

	public async deleteIntent(name: string): Promise<void> {
		await this.repository.deleteIntent(name);
	}

	public async updateIntent(name: string, description: string): Promise<void> {
		await this.repository.updateIntent({ name, description });
	}
}
