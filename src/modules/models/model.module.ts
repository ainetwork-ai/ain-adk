import type { SessionObject } from "@/types/memory.js";
import type { FetchResponse, IAgentTool } from "@/types/tool.js";

export abstract class BaseModel<MessageType, FunctionType> {
	abstract generateMessages(
		sessionHistory: SessionObject,
		query: string,
		systemPrompt?: string,
	): MessageType[];

	abstract expandMessages(messages: MessageType[], message: string): void;

	abstract convertToolsToFunctions(tools: IAgentTool[]): FunctionType[];

	abstract fetch(messages: MessageType[]): Promise<FetchResponse>;

	abstract fetchWithContextMessage(
		messages: MessageType[],
		functions: FunctionType[],
	): Promise<FetchResponse>;
}

export class ModelModule {
	private models: { [name: string]: BaseModel<unknown, unknown> } = {};
	private defaultModelName?: string;

	public addModel(
		name: string,
		model: BaseModel<unknown, unknown>,
		isDefault?: boolean,
	) {
		this.models[name] = model;
		if (isDefault || !this.defaultModelName) {
			this.defaultModelName = name;
		}
	}

	public getModel(name?: string): BaseModel<unknown, unknown> {
		if (!this.defaultModelName) {
			throw Error("No default model");
		}

		if (!name || !this.models[name]) {
			return this.models[this.defaultModelName];
		}
		return this.models[name];
	}

	public getModelList() {
		return {
			models: this.models,
			defaultModelName: this.defaultModelName,
		};
	}
}
