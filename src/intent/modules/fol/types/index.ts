export function createEmptyFols(): Fols {
	return {
		constants: [],
		predicates: [],
		facts: [],
	};
}

export type FolItem = {
	value: string;
	description: string;
	updatedAt?: string;
};

export interface FactItem {
	value: string;
	description: string;
	predicates: string[];
	arguments: string[];
	updatedAt?: string;
}

export interface Fols {
	constants: FolItem[];
	predicates: FolItem[];
	facts: FactItem[];
}
