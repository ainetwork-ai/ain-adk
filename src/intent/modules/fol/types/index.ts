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
export interface Facts {
	/** Constants represent individual objects or entities in the domain */
	constants: { name: string; description: string }[];
	/** Predicates represent properties or relationships between constants */
	predicates: { name: string; description: string }[];
	/** Facts are specific instances of predicates applied to constants */
	facts: { name: string; description: string }[];
}
