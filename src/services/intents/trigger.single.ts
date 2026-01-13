import type { MemoryModule, ModelModule } from "@/modules";
import type {
	MessageObject,
	ThreadObject,
	TriggeredIntent,
} from "@/types/memory";
import { loggers } from "@/utils/logger";

export class IntentTriggerService {
	private modelModule: ModelModule;
	private memoryModule?: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule?: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	/**
	 * Detects the intent from context.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns The detected intent
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<TriggeredIntent> {
		const modelInstance = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const intentMemory = this.memoryModule?.getIntentMemory();
		if (!intentMemory) {
			return { subquery: query };
		}

		// 인텐트 목록 가져오기
		const intents = await intentMemory.listIntents();

		if (intents.length === 0) {
			loggers.intentStream.warn("No intent found");
			return { subquery: query };
		}

		const intentList = intents
			.map((intent) => `- ${intent.name}: ${intent.description}`)
			.join("\n");

		// Convert thread messages to a string
		const threadMessages = !thread
			? ""
			: thread.messages
					.sort((a, b) => a.timestamp - b.timestamp)
					.map((message: MessageObject) => {
						const role =
							message.role === "USER"
								? "User"
								: message.role === "MODEL"
									? "Assistant"
									: "System";
						const content = Array.isArray(message.content.parts)
							? message.content.parts.join(" ")
							: String(message.content.parts);
						return `${role}: """${content}"""`;
					})
					.join("\n");

		const systemPrompt = `
You are an expert in accurately identifying user intentions.

Available intent list:
${intentList}

Please select and answer only from the above intent list. 
Please return only the exact intent name without any additional explanations or text.`;

		const userMessage = `
The following is the conversation history with the user:

${threadMessages}

Last user question: "${query}"

Based on the above conversation history, please determine what the intention of the last user question is. 
Please select and answer the most appropriate intent name from the available intent list.`;

		const messages = modelInstance.generateMessages({
			query: userMessage,
			systemPrompt,
		});

		const response = await modelInstance.fetch(messages, modelOptions);
		if (!response.content) {
			throw new Error("No intent detected");
		}
		const intentName = response.content.trim();
		const intent = await intentMemory.getIntent(intentName);
		if (!intent) {
			throw new Error(`No intent found: ${intentName}`);
		}

		return {
			subquery: query,
			intent,
		};
	}
}
