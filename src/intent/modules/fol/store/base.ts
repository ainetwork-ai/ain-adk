import type { FactItem, FolItem, Fols } from "../types/index.js";

export abstract class FOLStore {
	abstract saveFacts(fols: Fols): Promise<void>;

	abstract retrieveConstantsByQuery(query?: string): Promise<FolItem[]>;
	abstract retrievePredicatesByQuery(query?: string): Promise<FolItem[]>;
	abstract retrieveFactsByQuery(query: string): Promise<FactItem[]>;
	abstract getAllFols(): Promise<Fols>;
}
