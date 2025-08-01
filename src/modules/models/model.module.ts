import type { BaseModel } from "./base.model.js";

/*
 * Module for managing multiple AI model implementations.
 *
 * Allows registration of multiple models and provides a unified interface
 * for accessing them. Supports setting a default model for convenience.
 *
 * @example
 * ```typescript
 * const modelModule = new ModelModule();
 * modelModule.addModel("gpt-4", new OpenAIModel("gpt-4"), true);
 * modelModule.addModel("gemini", new GeminiModel("gemini-pro"));
 *
 * const defaultModel = modelModule.getModel();
 * const specificModel = modelModule.getModel("gemini");
 * ```
 */
export class ModelModule {
	/** Registry of available models indexed by name */
	private models: { [name: string]: BaseModel<unknown, unknown> } = {};
	/** Name of the default model to use when none specified */
	private defaultModelName?: string;

	/**
	 * Registers a new model with the module.
	 *
	 * @param name - Unique identifier for the model
	 * @param model - Model instance implementing BaseModel
	 * @param isDefault - Whether to set this as the default model
	 */
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

	/**
	 * Retrieves a model by name or returns the default model.
	 *
	 * @param name - Optional model name to retrieve
	 * @returns The requested model or default model if name not provided
	 * @throws Error if no default model is set and name is not provided
	 */
	public getModel(name?: string): BaseModel<unknown, unknown> {
		if (!this.defaultModelName) {
			throw Error("No default model");
		}

		if (!name || !this.models[name]) {
			return this.models[this.defaultModelName];
		}
		return this.models[name];
	}

	/**
	 * Returns information about all registered models.
	 *
	 * @returns Object containing all models and the default model name
	 */
	public getModelList() {
		return {
			models: Object.keys(this.models),
			defaultModelName: this.defaultModelName,
		};
	}
}
