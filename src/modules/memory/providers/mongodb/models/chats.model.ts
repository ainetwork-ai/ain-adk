import mongoose, { type Document, Schema } from "mongoose";

// ChatRole enum
export enum ChatRole {
	USER = "USER",
	SYSTEM = "SYSTEM",
	MODEL = "MODEL",
}

// ChatContentObject schema
const ChatContentObjectSchema = new Schema(
	{
		type: { type: String, required: true },
		parts: { type: [Schema.Types.Mixed], required: true },
	},
	{ _id: false },
);

// ChatObject schema - 개별 문서로 저장
const ChatObjectSchema = new Schema(
	{
		sessionId: {
			type: String,
			required: true,
			index: true,
		},
		role: {
			type: String,
			enum: Object.values(ChatRole),
			required: true,
		},
		content: {
			type: ChatContentObjectSchema,
			required: true,
		},
		timestamp: {
			type: Number,
			required: true,
		},
		metadata: {
			type: Schema.Types.Mixed,
			default: {},
		},
	},
	{
		timestamps: true,
	},
);

// Chat Document interface
export interface ChatDocument extends Document {
	sessionId: string;
	role: ChatRole;
	content: {
		type: string;
		parts: any[];
	};
	timestamp: number;
	metadata?: { [key: string]: unknown };
	createdAt: Date;
	updatedAt: Date;
}

// Export the model
export const ChatModel = mongoose.model<ChatDocument>("Chat", ChatObjectSchema);
