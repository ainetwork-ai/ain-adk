import type { MemoryModule, ModelModule } from "@/modules/index.js";
import { loggers } from "@/utils/logger.js";
import piiFilterPrompt from "./prompts/pii-filter.js";

export class PIIService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	isEnabled(): boolean {
		const value = process.env.ENABLE_PII_FILTER;
		return value === "true" || value === "1";
	}

	async filterText(text: string): Promise<string> {
		if (!this.isEnabled() || !text.trim()) {
			return text;
		}

		try {
			const modelInstance = this.modelModule.getModel();
			const modelOptions = this.modelModule.getModelOptions();
			const messages = modelInstance.generateMessages({
				query: text,
				systemPrompt: await piiFilterPrompt(this.memoryModule),
			});
			const response = await modelInstance.fetch(messages, modelOptions);
			return response.content || text;
		} catch (error) {
			loggers.intent.error("PII filtering failed, returning original text", {
				error,
			});
			return text;
		}
	}
}
