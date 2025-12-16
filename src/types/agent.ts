import type { StatusCodes } from "http-status-codes";

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
	/** Optional public URL for A2A protocol discovery and communication */
	url?: string;
};

export class AinHttpError extends Error {
	public status?: StatusCodes;

	constructor(status: StatusCodes, message: string) {
		super(message);
		this.status = status;
	}
}
