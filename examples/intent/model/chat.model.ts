import mongoose, { Schema, Document } from "mongoose";

export interface ChatDocument extends Document {
  user: string;
  assistant?: string;
  intent: {
    name: string;
    description: string;
  };
  createdAt: Date;
}

const ChatSchema = new Schema<ChatDocument>({
  user: { type: String, required: true },
  assistant: { type: String },
  intent: {
    name: { type: String, required: true },
    description: { type: String, required: true },
  },
  createdAt: { type: Date, default: Date.now },
});

export const ChatModel = mongoose.model<ChatDocument>("Chat", ChatSchema); 