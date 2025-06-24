import type { Facts } from "../types/index.js";

export abstract class FOLStore {
	abstract saveFacts(intent: string, facts: Facts): Promise<void>;
	abstract retrieveFacts(intent: string): Promise<Facts | null>;
	abstract getAllFacts(): Promise<{ [intent: string]: Facts }>;
}
