import { getManifest } from "@/config/manifest";
import type { A2AModule, MCPModule, ModelModule } from "@/modules";
import { CONNECTOR_PROTOCOL_TYPE, type ConnectorTool } from "@/types/connector";
import type { ThreadObject } from "@/types/memory";
import type { StreamEvent } from "@/types/stream";
import { loggers } from "@/utils/logger";
import {
	splitAdkToolArgs,
	truncateThinkingDescription,
} from "@/utils/tool-args";

export type ToolCallingMode = "all" | "mcp";

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

		while (true) {
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

			const assembledToolCalls: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[] = [];

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
				break;
			}

			for (const toolCall of assembledToolCalls) {
				const toolName = toolCall.function.name;
				const selectedTool = this.selectTool(tools, toolName);
				if (!selectedTool) {
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
					modelInstance.appendMessages(
						params.messages,
						`[Bot Called Tool ${toolName}]\nInvalid tool arguments JSON: ${toolCall.function.arguments}`,
					);
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
				modelInstance.appendMessages(params.messages, toolResult);
			}
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
