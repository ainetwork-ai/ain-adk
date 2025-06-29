import { ChatModel, ChatDocument } from "../model/chat.model";

export class ChatRepository {
  async create(chat: Omit<ChatDocument, "_id">) {
    return ChatModel.create(chat);
  }

  async findAll() {
    return ChatModel.find().sort({ createdAt: 1 });
  }

  async findById(id: string) {
    return ChatModel.findById(id);
  }
} 