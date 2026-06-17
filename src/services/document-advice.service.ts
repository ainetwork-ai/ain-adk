import type { MemoryModule, ModelModule } from "@/modules";
import type { StreamEvent } from "@/types/stream.js";
import { renderDocument } from "@/utils/document-render.js";
import { loggers } from "@/utils/logger.js";
import documentAdvicePrompt from "./prompts/document-advice.js";

/**
 * Generates AI advice for a document by running a single-turn streaming model
 * completion over the document's rendered content, then caches the result on
 * `document.advice`.
 */
export class DocumentAdviceService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	async *generateAdviceStream(
		documentId: string,
		signal?: AbortSignal,
	): AsyncGenerator<StreamEvent> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		if (!documentMemory) {
			throw new Error("Document memory is not initialized");
		}
		const document = await documentMemory.getDocument(documentId);
		if (!document) {
			throw new Error(`Document not found: ${documentId}`);
		}

		const renderedContent = renderDocument(document);
		const systemPrompt = await documentAdvicePrompt(this.memoryModule);

		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const messages = model.generateMessages({
			query: renderedContent,
			systemPrompt,
		});

		let content = "";
		const stream = await model.fetchStreamWithContextMessage(
			messages,
			[],
			modelOptions,
		);
		for await (const chunk of stream) {
			if (signal?.aborted) {
				throw new Error("Advice generation aborted by client");
			}
			if (chunk.delta?.content) {
				content += chunk.delta.content;
				yield { event: "text_chunk", data: { delta: chunk.delta.content } };
			}
		}

		if (!content.trim()) {
			return;
		}

		try {
			await documentMemory.updateDocument(documentId, {
				advice: { content, generatedAt: new Date().toISOString() },
				version: document.version + 1,
				updatedAt: new Date().toISOString(),
			});
		} catch (saveError) {
			loggers.agent.error("Failed to cache document advice", {
				documentId,
				error: saveError,
			});
		}
	}
}
