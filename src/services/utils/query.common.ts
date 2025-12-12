import type { ModelFetchOptions, ModelModule } from "@/modules";
import { loggers } from "@/utils/logger.js";

export async function generateTitle(
	modelModule: ModelModule,
	query: string,
	options?: ModelFetchOptions,
): Promise<string> {
	const DEFAULT_TITLE = "New Chat";
	try {
		const modelInstance = modelModule.getModel();
		const modelOptions = modelModule.getModelOptions();
		const messages = modelInstance.generateMessages({
			query,
			systemPrompt: `
Today is ${new Date().toLocaleDateString()}.
You are a helpful assistant that generates titles for conversations.
Please analyze the user's query and create a concise title that accurately reflects the conversation's core topic.
The title must be no more than 5 words long.
Respond with only the title. Do not include any punctuation or extra explanations.
Always respond in the same language as the user's input.`,
		});
		const response = await modelInstance.fetch(
			messages,
			options ?? modelOptions,
		);
		return response.content || DEFAULT_TITLE;
	} catch (error) {
		loggers.intent.error("Error generating title", {
			error,
			query,
		});
		return DEFAULT_TITLE;
	}
}
