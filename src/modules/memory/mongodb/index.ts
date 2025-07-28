import type { ChatObject, SessionObject } from "@/types/memory.js";
import { BaseMemory } from "../memory.module.js";
import { ChatDocument, ChatModel, ChatRole } from "./models/chats.model.js";

export class MongoDBMemory extends BaseMemory {
	constructor() {
		super();
	}

	public async getSessionHistory(sessionId: string): Promise<SessionObject> {
		const chats = await ChatModel.find({ sessionId }).sort({
			timestamp: 1,
		});

		const sessionObject: SessionObject = { chats: {} };
		chats.forEach((chat: ChatDocument) => {
			const chatId = chat._id?.toString() || chat.id;
			sessionObject.chats[chatId] = {
				role: chat.role as ChatRole,
				content: chat.content,
				timestamp: chat.timestamp,
				metadata: chat.metadata,
			};
		});

		return sessionObject;
	}

	public async updateSessionHistory(
		sessionId: string,
		chat: ChatObject,
	): Promise<void> {
		await ChatModel.create({
			sessionId,
			role: chat.role,
			content: chat.content,
			timestamp: chat.timestamp,
			metadata: chat.metadata,
		});
	}

	public async storeQueryAndIntent(
		query: string,
		intent: string,
		sessionId: string,
	): Promise<void> {
		// Intent 정보를 metadata에 저장
		const chat: ChatObject = {
			role: ChatRole.USER,
			content: {
				type: "text",
				parts: [query],
			},
			timestamp: Date.now(),
			metadata: {
				intent,
				query,
			},
		};

		await this.updateSessionHistory(sessionId, chat);
	}
}
