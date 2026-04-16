import type { MemoryModule, ModelModule } from "@/modules/index.js";
import { loggers } from "@/utils/logger.js";
import { createModelInputMessage } from "@/utils/message.js";
import piiDetectPrompt from "./prompts/pii-detect.js";
import piiFilterPrompt from "./prompts/pii-filter.js";

export enum PIIFilterMode {
	REJECT = "reject",
	MASK = "mask",
	DISABLED = "disabled",
}

export class PIIService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	getMode(): PIIFilterMode {
		const value = process.env.PII_FILTER_MODE?.toLowerCase();
		if (value === PIIFilterMode.REJECT) return PIIFilterMode.REJECT;
		if (value === PIIFilterMode.MASK) return PIIFilterMode.MASK;
		return PIIFilterMode.DISABLED;
	}

	isEnabled(): boolean {
		return this.getMode() !== PIIFilterMode.DISABLED;
	}

	async containsPII(text: string): Promise<boolean> {
		if (!text.trim()) return false;

		try {
			const modelInstance = this.modelModule.getModel("pii-model");
			const modelOptions = this.modelModule.getModelOptions();
			const messages = modelInstance.generateMessages({
				query: text,
				input: createModelInputMessage({ text }),
				systemPrompt: await piiDetectPrompt(this.memoryModule),
			});
			const response = await modelInstance.fetch(messages, modelOptions);
			return response.content?.trim().toLowerCase() === "true";
		} catch (error) {
			loggers.intent.error("PII detection failed", { error });
			return false;
		}
	}

	async filterText(text: string): Promise<string> {
		if (!text.trim()) return text;

		try {
			const modelInstance = this.modelModule.getModel();
			const modelOptions = this.modelModule.getModelOptions();
			const messages = modelInstance.generateMessages({
				query: text,
				input: createModelInputMessage({ text }),
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
