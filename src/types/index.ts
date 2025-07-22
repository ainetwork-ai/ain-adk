/**
 * Custom prompts configuration for the agent.
 *
 * Allows customization of agent behavior through system and agent-level prompts.
 */
export type AinAgentPrompts = {
	/** Agent-level prompt that defines the agent's personality and behavior */
	agent?: string;
	/** System-level prompt that provides context and instructions */
	system?: string;
};

/**
 * Agent manifest containing essential metadata and configuration.
 *
 * The manifest defines the agent's identity, version, and optional configuration
 * such as the public URL for A2A protocol support and custom prompts.
 *
 * @example
 * ```typescript
 * const manifest: AinAgentManifest = {
 *   name: "CustomerSupportAgent",
 *   description: "AI agent for handling customer support queries",
 *   version: "1.0.0",
 *   url: "https://api.example.com/agent",
 *   prompts: {
 *     system: "You are a helpful customer support assistant.",
 *     agent: "Always be polite and provide detailed solutions."
 *   }
 * };
 * ```
 */
export type AinAgentManifest = {
	/** Unique name identifier for the agent */
	name: string;
	/** Human-readable description of the agent's purpose and capabilities */
	description: string;
	/** Semantic version of the agent (e.g., "1.0.0") */
	version: string;
	/** Optional public URL for A2A protocol discovery and communication */
	url?: string;
	/** Optional custom prompts to configure agent behavior */
	prompts?: AinAgentPrompts;
};
