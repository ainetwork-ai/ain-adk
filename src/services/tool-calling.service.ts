import { getManifest } from "@/config/manifest";
import type { A2AModule, MCPModule, ModelModule } from "@/modules";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import type { ThreadObject } from "@/types/memory";
import type { AssembledToolCall, StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import {
	splitAdkToolArgs,
	truncateThinkingDescription,
} from "@/utils/tool-args";

export type ToolCallingMode = "all" | "mcp";

/**
 * Hard cap on the tool-calling iteration loop. The loop normally exits when
 * the model returns a turn with no tool_calls; the cap is a defense-in-depth
 * guard against runaway interactions caused by protocol drift or persistent
 * model loops.
 */
export const MAX_TOOL_ITERATIONS = 15;

export class ToolCallingService {
	private modelModule: ModelModule;
	private a2aModule?: A2AModule;
	private mcpModule?: MCPModule;

	constructor(
		modelModule: ModelModule,
		a2aModule?: A2AModule,
		mcpModule?: MCPModule,
	) {
		this.modelModule = modelModule;
		this.a2aModule = a2aModule;
		this.mcpModule = mcpModule;
	}

	async getTools(params: {
		toolPrompt: string;
		mode?: ToolCallingMode;
	}): Promise<ConnectorTool[]> {
		const tools: ConnectorTool[] = [];
		this.mcpModule && tools.push(...this.mcpModule.getTools(params.toolPrompt));
		if (params.mode !== "mcp") {
			this.a2aModule &&
				tools.push(...(await this.a2aModule.getTools(params.toolPrompt)));
		}
		return tools;
	}

	async *run(params: {
		messages: unknown[];
		tools: ConnectorTool[];
		query: string;
		thread: ThreadObject;
		toolChoice?: "auto" | "required";
	}): AsyncGenerator<StreamEvent, { toolCallsExecuted: number }, unknown> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const tools = [...params.tools];
		const processList: string[] = [];
		let isFirstCall = true;
		let iteration = 0;

		for (; iteration < MAX_TOOL_ITERATIONS; iteration++) {
			const functions = modelInstance.convertToolsToFunctions(tools);
			const toolChoice =
				isFirstCall && params.toolChoice === "required" && functions.length > 0
					? ("required" as const)
					: ("auto" as const);
			const options = { ...modelOptions, toolChoice };
			const responseStream = await modelInstance.fetchStreamWithContextMessage(
				params.messages,
				functions,
				options,
			);
			isFirstCall = false;

			const assembledToolCalls: AssembledToolCall[] = [];
			let assistantText = "";

			for await (const chunk of responseStream) {
				const delta = chunk.delta;
				if (delta?.tool_calls) {
					for (const { index, id, function: func } of delta.tool_calls) {
						assembledToolCalls[index] ??= {
							id: "",
							type: "function",
							function: { name: "", arguments: "" },
						};

						if (id) assembledToolCalls[index].id = id;
						if (func?.name) assembledToolCalls[index].function.name = func.name;
						if (func?.arguments) {
							assembledToolCalls[index].function.arguments += func.arguments;
						}
					}
				} else if (chunk.delta?.content) {
					assistantText += chunk.delta.content;
					yield {
						event: "text_chunk",
						data: { delta: chunk.delta.content },
					};
				}
			}

			loggers.intentStream.debug("assembledToolCalls", {
				threadId: params.thread.threadId,
				assembledToolCalls,
			});

			if (assembledToolCalls.length === 0) {
				return { toolCallsExecuted: processList.length };
			}

			modelInstance.appendAssistantToolCallTurn(params.messages, {
				content: assistantText.length > 0 ? assistantText : null,
				toolCalls: assembledToolCalls,
			});

			for (const toolCall of assembledToolCalls) {
				const toolName = toolCall.function.name;
				const selectedTool = this.selectTool(tools, toolName);
				if (!selectedTool) {
					loggers.intent.warn("Tool not found", {
						toolName,
						toolCallId: toolCall.id,
					});
					modelInstance.appendToolResult(params.messages, {
						toolCallId: toolCall.id,
						toolName,
						content: `Tool "${toolName}" is not available.`,
						isError: true,
					});
					continue;
				}

				let toolArgs: Record<string, unknown>;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments || "{}");
				} catch (error) {
					loggers.intent.warn("Invalid tool arguments JSON", {
						toolName,
						arguments: toolCall.function.arguments,
						error,
					});
					modelInstance.appendToolResult(params.messages, {
						toolCallId: toolCall.id,
						toolName,
						content: `Invalid tool arguments JSON: ${toolCall.function.arguments}`,
						isError: true,
					});
					continue;
				}

				const { thinkingText, protocolArgs } = splitAdkToolArgs(toolArgs);
				yield {
					event: "thinking_process",
					data: {
						title: `[${getManifest().name}] ${selectedTool.protocol} 실행: ${toolName}`,
						description: truncateThinkingDescription(thinkingText),
					},
				};

				const toolResult = yield* this.executeTool({
					toolName,
					selectedTool,
					protocolArgs,
					query: params.query,
					thread: params.thread,
				});

				loggers.intent.debug("Tool Result", { toolResult });
				processList.push(toolResult);
				modelInstance.appendToolResult(params.messages, {
					toolCallId: toolCall.id,
					toolName,
					content: toolResult,
				});
			}
		}

		if (iteration >= MAX_TOOL_ITERATIONS) {
			loggers.intent.warn("Tool calling loop reached max iterations cap", {
				threadId: params.thread.threadId,
				maxIterations: MAX_TOOL_ITERATIONS,
			});
		}

		return { toolCallsExecuted: processList.length };
	}

	private selectTool(
		tools: ConnectorTool[],
		toolName: string,
	): ConnectorTool | undefined {
		for (const [index, tool] of tools.entries()) {
			if (tool.toolName !== toolName) {
				continue;
			}

			if (tool.protocol === CONNECTOR_PROTOCOL_TYPE.A2A) {
				return tools.splice(index, 1)[0];
			}

			return tool;
		}
	}

	private async *executeTool(params: {
		toolName: string;
		selectedTool: ConnectorTool;
		protocolArgs: Record<string, unknown>;
		query: string;
		thread: ThreadObject;
	}): AsyncGenerator<StreamEvent, string, unknown> {
		const { selectedTool, toolName, protocolArgs, query, thread } = params;

		if (
			this.mcpModule &&
			selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.MCP
		) {
			loggers.intent.info("MCP tool call", {
				toolName,
				toolArgs: protocolArgs,
			});
			return await this.mcpModule.useTool(selectedTool, protocolArgs);
		}

		if (
			this.a2aModule &&
			selectedTool.protocol === CONNECTOR_PROTOCOL_TYPE.A2A
		) {
			loggers.intent.info("A2A tool call", { toolName });
			const a2aStream = this.a2aModule.useTool(
				selectedTool,
				query,
				thread.threadId,
			);
			let result = await a2aStream.next();
			while (!result.done) {
				if (result.value.event === "thinking_process") {
					yield result.value;
				}
				result = await a2aStream.next();
			}
			return result.value;
		}

		loggers.intent.warn(`Unrecognized tool type: ${selectedTool.protocol}`);
		return "";
	}
}
