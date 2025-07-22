/**
 * Represents a First-Order Logic (FOL) knowledge base structure.
 *
 * FOL is used for representing and reasoning about knowledge in the agent.
 * This interface defines the structure for storing constants, predicates,
 * and facts that make up the agent's knowledge representation.
 *
 * @example
 * ```typescript
 * const knowledge: Facts = {
 *   constants: [
 *     { name: "John", description: "A person named John" },
 *     { name: "Mary", description: "A person named Mary" }
 *   ],
 *   predicates: [
 *     { name: "likes", description: "Represents liking relationship" },
 *     { name: "knows", description: "Represents knowing relationship" }
 *   ],
 *   facts: [
 *     { name: "likes(John, Mary)", description: "John likes Mary" },
 *     { name: "knows(Mary, John)", description: "Mary knows John" }
 *   ]
 * };
 * ```
 */
export type FactElement = {
	name: string;
	description: string;
};

export type Facts = {
	/** Constants represent individual objects or entities in the domain */
	constants: FactElement[];
	/** Predicates represent properties or relationships between constants */
	predicates: FactElement[];
	/** Facts are specific instances of predicates applied to constants */
	facts: FactElement[];
};
