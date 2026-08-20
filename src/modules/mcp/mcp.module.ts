import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { getArtifactModule } from "@/config/modules.js";
import {
	CONNECTOR_PROTOCOL_TYPE,
	type ConnectorTool,
} from "@/types/connector.js";
import type { MCPConfig } from "@/types/mcp.js";
import type { ArtifactContentPart } from "@/types/memory.js";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import { withAdkThinkingArg } from "@/utils/tool-args.js";
import type { IArtifactStore } from "../artifacts/base.artifact.js";
import { MCPConnector } from "./mcp.connector.js";

function safeGetArtifactStore(): IArtifactStore | undefined {
	try {
		return getArtifactModule()?.getStore();
	} catch {
		// Modules not initialized (standalone module usage): no artifact storage.
		return undefined;
	}
}

type BinaryBlock = { data: string; mimeType: string; name: string };

/** Recognizes MCP binary content blocks: image/audio base64 and resource blobs. */
function extractBinaryBlock(
	block: unknown,
	toolName: string,
	index: number,
): BinaryBlock | undefined {
	if (!block || typeof block !== "object") {
		return undefined;
	}
	const candidate = block as {
		type?: string;
		data?: unknown;
		mimeType?: unknown;
		resource?: { uri?: unknown; mimeType?: unknown; blob?: unknown };
	};

	if (
		(candidate.type === "image" || candidate.type === "audio") &&
		typeof candidate.data === "string" &&
		typeof candidate.mimeType === "string"
	) {
		const subtype = candidate.mimeType.split("/")[1]?.split("+")[0] || "bin";
		return {
			data: candidate.data,
			mimeType: candidate.mimeType,
			name: `${toolName}-output-${index}.${subtype}`,
		};
	}

	if (
		candidate.type === "resource" &&
		typeof candidate.resource?.blob === "string"
	) {
		const uri =
			typeof candidate.resource.uri === "string" ? candidate.resource.uri : "";
		return {
			data: candidate.resource.blob,
			mimeType:
				typeof candidate.resource.mimeType === "string"
					? candidate.resource.mimeType
					: "application/octet-stream",
			name:
				uri.split("/").filter(Boolean).pop() ||
				`${toolName}-output-${index}.bin`,
		};
	}

	return undefined;
}

/**
 * Module for managing Model Context Protocol (MCP) server connections.
 *
 * This module handles the lifecycle of MCP client connections, discovers
 * available tools from connected servers, and provides an interface for
 * executing those tools. Multiple MCP servers can be connected simultaneously.
 */
export class MCPModule {
	private mcpConnectors: Map<string, MCPConnector> = new Map();

	addMCPConnector(configs: { [name: string]: MCPConfig }): void {
		for (const [name, config] of Object.entries(configs)) {
			const conn = new MCPConnector(name, config);
			this.mcpConnectors.set(name, conn);
		}
	}

	private getOrCreateClient(connector: MCPConnector): MCPClient {
		connector.client ??= new MCPClient({
			name: connector.name,
			version: "1.0.0",
		});
		return connector.client;
	}

	async connectToServers(): Promise<void> {
		for (const [name, conn] of this.mcpConnectors.entries()) {
			try {
				const mcpClient = this.getOrCreateClient(conn);
				const config = conn.config;
				switch (config.type) {
					case "stdio": {
						const transport = new StdioClientTransport(config.params);
						await mcpClient.connect(transport);
						break;
					}
					case "websocket": {
						const transport = new WebSocketClientTransport(config.url);
						await mcpClient.connect(transport);
						break;
					}
					case "sse": {
						const transport = new SSEClientTransport(
							config.url,
							config.options,
						);
						await mcpClient.connect(transport);
						break;
					}
					case "streamableHttp": {
						const transport = new StreamableHTTPClientTransport(
							config.url,
							config.options,
						);
						await mcpClient.connect(transport);
						break;
					}
					default:
						// This cannot happen.
						loggers.mcp.error("Unsupported MCP config type");
						break;
				}

				const toolList = await mcpClient.listTools();
				conn.tools = toolList.tools.map((tool) => {
					return {
						toolName: `${name}-${tool.name}`, // to avoid tool name duplication
						connectorName: name,
						protocol: CONNECTOR_PROTOCOL_TYPE.MCP,
						description: tool.description,
						inputSchema: tool.inputSchema,
					};
				});
				loggers.mcp.info("Connected to MCP server with tools:", {
					tools: conn.tools.map((tool) => tool.toolName),
				});
			} catch (error) {
				loggers.mcp.error(`Failed to connect to MCP server ${name}`, { error });
			}
		}
	}

	/**
	 * Returns all available tools from connected MCP servers.
	 *
	 * @returns Array of MCPTool instances representing available tools
	 */
	getTools(prompt: string): Array<ConnectorTool> {
		const allTools: Array<ConnectorTool> = [];
		for (const conn of this.mcpConnectors.values()) {
			if (!conn.enabled) {
				continue;
			}

			for (const tool of conn.tools) {
				allTools.push({
					toolName: tool.toolName,
					connectorName: tool.connectorName,
					protocol: tool.protocol,
					description: tool.description,
					inputSchema: withAdkThinkingArg(tool.inputSchema, prompt),
				});
			}
		}
		return allTools;
	}

	/**
	 * Executes a tool on its corresponding MCP server.
	 *
	 * Binary content blocks (image/audio/resource-blob) are stored through the
	 * configured artifact store and yielded as `artifact_ready` events; the
	 * serialized text result carries artifact references instead of base64
	 * payloads. Without an artifact store, binary payloads are omitted.
	 *
	 * @param tool - The MCPTool instance to execute
	 * @param _args - Arguments to pass to the tool
	 * @param context - Ownership/linkage metadata for stored artifacts
	 * @returns AsyncGenerator yielding stream events and returning the text result
	 */
	async *useTool(
		tool: ConnectorTool,
		_args?: Record<string, unknown>,
		context?: { userId?: string; threadId?: string },
	): AsyncGenerator<StreamEvent, string, unknown> {
		const { connectorName, toolName } = tool;
		const connector = this.mcpConnectors.get(connectorName);
		const client = connector?.client;

		try {
			if (!client) {
				throw new Error(`Invalid MCP Tool ${toolName}`);
			}

			// `${name}-${tool.name}` => tool.name
			const mcpToolName = toolName.slice(connectorName.length + 1);
			// Per-connector timeout override (defaults to the SDK's 60s when unset).
			// resetTimeoutOnProgress lets a tool that streams progress notifications
			// keep the call alive past the base timeout.
			const requestTimeoutMs = connector?.config.requestTimeoutMs;
			const result = await client.callTool(
				{
					name: mcpToolName,
					arguments: _args,
				},
				undefined,
				requestTimeoutMs !== undefined
					? { timeout: requestTimeoutMs, resetTimeoutOnProgress: true }
					: undefined,
			);
			const { content, events } = await this.replaceBinaryBlocks(
				toolName,
				result.content,
				context,
			);
			for (const event of events) {
				yield event;
			}
			return (
				`[Bot Called Tool ${toolName} with args ${JSON.stringify(_args)}]\n` +
				JSON.stringify(content, null, 2)
			);
		} catch (error) {
			loggers.mcp.error("Failed to call tool", { error });
			const toolResult = `[Bot Called Tool ${toolName} with args ${JSON.stringify(_args)}]\n${typeof error === "string" ? error : JSON.stringify(error, null, 2)}`;
			return toolResult;
		}
	}

	/**
	 * Replaces binary content blocks with artifact references (when a store is
	 * configured) or omission notes, so base64 payloads never reach model
	 * context. Returns the sanitized content plus artifact_ready events.
	 */
	private async replaceBinaryBlocks(
		toolName: string,
		content: unknown,
		context?: { userId?: string; threadId?: string },
	): Promise<{ content: unknown; events: StreamEvent[] }> {
		if (!Array.isArray(content)) {
			return { content, events: [] };
		}

		const store = safeGetArtifactStore();
		const events: StreamEvent[] = [];
		const blocks = await Promise.all(
			content.map(async (block, index) => {
				const binary = extractBinaryBlock(block, toolName, index);
				if (!binary) {
					return block;
				}

				const bytes = Buffer.from(binary.data, "base64");
				if (store) {
					try {
						const artifact = await store.put({
							name: binary.name,
							mimeType: binary.mimeType,
							data: bytes,
							userId: context?.userId,
							threadId: context?.threadId,
						});
						const part: ArtifactContentPart = {
							kind: "artifact",
							artifactId: artifact.artifactId,
							name: artifact.name,
							mimeType: artifact.mimeType,
							size: artifact.size,
							downloadUrl: `/api/artifacts/${artifact.artifactId}/download`,
						};
						events.push({ event: "artifact_ready", data: part });
						return { type: (block as { type?: string }).type, artifact: part };
					} catch (error) {
						loggers.mcp.warn("Failed to store tool binary output", {
							toolName,
							error,
						});
						return {
							type: (block as { type?: string }).type,
							mimeType: binary.mimeType,
							note: `binary content omitted (${bytes.byteLength} bytes; failed to store artifact)`,
						};
					}
				}

				return {
					type: (block as { type?: string }).type,
					mimeType: binary.mimeType,
					note: `binary content omitted (${bytes.byteLength} bytes; artifact storage not configured)`,
				};
			}),
		);
		return { content: blocks, events };
	}

	/**
	 * Closes all MCP client connections.
	 *
	 * Should be called when shutting down the application to ensure
	 * all MCP connections are properly closed.
	 */
	async cleanup() {
		const results = await Promise.allSettled(
			Array.from(this.mcpConnectors.entries()).map(async ([name, conn]) => {
				if (conn.client) {
					await conn.client.close();
				}
				return name;
			}),
		);
		for (const result of results) {
			if (result.status === "rejected") {
				loggers.mcp.error("Failed to close MCP connector", {
					error: result.reason,
				});
			}
		}
	}
}
