import type { ThreadMetadata } from "@/types/memory.js";
import type { CONNECTOR_PROTOCOL_TYPE } from "./connector";

export type StreamEvent =
	| { event: "text_chunk"; data: { delta: string } }
	| {
			event: "tool_start";
			data: {
				toolCallId: string;
				protocol: CONNECTOR_PROTOCOL_TYPE;
				toolName: string;
				toolArgs: unknown;
			};
	  }
	| {
			event: "tool_output";
			data: {
				toolCallId: string;
				protocol: CONNECTOR_PROTOCOL_TYPE;
				toolName: string;
				result: unknown;
			};
	  }
	| { event: "error"; data: { message: string } }
	| { event: "thread_id"; data: ThreadMetadata }
	| { event: "intent_process"; data: { subquery: string; actionPlan: string } }
	| { event: "collection_name"; data: { name: string } }
	| { event: "thinking_process"; data: { title: string; description: string } };

/**
 * Tool call delta for streaming tool invocations
 */
export interface ToolCallDelta {
	index: number;
	id?: string;
	type?: "function";
	function?: {
		name?: string;
		arguments?: string;
	};
}

/**
 * Normalized stream chunk interface for all LLM providers.
 *
 * This interface provides a consistent structure for stream responses
 * across different AI model providers (OpenAI, Gemini, Claude, etc.)
 */
export interface StreamChunk {
	/** Text content delta from the model */
	delta?: {
		role?: string;
		content?: string;
		tool_calls?: ToolCallDelta[];
	};
	/** Indicates if the stream has finished and why */
	finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null;
	/** Provider-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Async iterable stream interface for LLM responses
 */
export interface LLMStream extends AsyncIterable<StreamChunk> {
	/** Cancels the stream */
	cancel?: () => void;
	/** Stream metadata */
	metadata?: Record<string, unknown>;
}
