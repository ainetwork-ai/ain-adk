import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type MCPConfig =
	| { type: "stdio"; params: StdioServerParameters }
	| { type: "websocket"; url: URL }
	| { type: "sse"; url: URL; options?: SSEClientTransportOptions }
	| {
			type: "streamableHttp";
			url: URL;
			options?: StreamableHTTPClientTransportOptions;
	  };
