import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Per-connector knobs shared across every transport type.
 *
 * `requestTimeoutMs` overrides the MCP SDK's default per-request timeout
 * (`DEFAULT_REQUEST_TIMEOUT_MSEC`, 60s) for tool calls on this connector. Raise
 * it for connectors that expose long-running tools (e.g. multi-day reasoning
 * scans) so a slow-but-valid call isn't aborted as a -32001 timeout.
 */
interface MCPConfigCommon {
	requestTimeoutMs?: number;
}

export type MCPConfig = MCPConfigCommon &
	(
		| { type: "stdio"; params: StdioServerParameters }
		| { type: "websocket"; url: URL }
		| { type: "sse"; url: URL; options?: SSEClientTransportOptions }
		| {
				type: "streamableHttp";
				url: URL;
				options?: StreamableHTTPClientTransportOptions;
		  }
	);
