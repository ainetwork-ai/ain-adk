import mongoose from "mongoose";
import type { ChatObject, SessionObject } from "@/types/memory.js";
import { loggers } from "@/utils/logger.js";
import { BaseMemory } from "../../base/index.js";
import {
	type ChatDocument,
	ChatModel,
	ChatRole,
} from "./models/chats.model.js";

export class MongoDBMemory extends BaseMemory {
	private isConnected = false;

	constructor(uri: string) {
		super();
		this.connect(uri);
	}

	public async connect(uri: string): Promise<void> {
		if (this.isConnected) {
			return;
		}

		try {
			await mongoose.connect(uri);
			this.isConnected = true;
			loggers.agent.info("MongoDB connected successfully");
		} catch (error) {
			loggers.agent.error("Failed to connect to MongoDB:", error);
			throw error;
		}
	}

	public async disconnect(): Promise<void> {
		if (!this.isConnected) {
			return;
		}

		try {
			await mongoose.disconnect();
			this.isConnected = false;
			loggers.agent.info("MongoDB disconnected successfully");
		} catch (error) {
			loggers.agent.error("Failed to disconnect from MongoDB:", error);
			throw error;
		}
	}

	public async getSessionHistory(sessionId: string): Promise<SessionObject> {
		const chats = await ChatModel.find({ sessionId }).sort({
			timestamp: 1,
		});

		loggers.agent.info(`Found ${chats.length} chats for session ${sessionId}`);

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
		loggers.agent.info(`Updating session history for session ${sessionId}`);
		loggers.agent.info(`Chat: ${JSON.stringify(chat)}`);

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
