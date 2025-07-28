import mongoose, { type Document, Schema } from "mongoose";

const MessageSchema = new Schema(
	{
		role: {
			type: String,
			enum: ["system", "user", "assistant", "tool", "function"],
			required: true,
		},
		content: {
			type: Schema.Types.Mixed, // string 또는 object array
			required: true,
		},
	},
	{ _id: false },
);

export interface IntentTriggeringInfoDocument extends Document {
	context: {
		messages: Array<{
			role: string;
			content:
				| string
				| Array<
						| { type: "text"; text: string }
						| { type: "image_url"; image_url: { url: string } }
				  >;
		}>;
	};
	intent: {
		name: string;
		description: string;
	};
}

const IntentTriggeringInfoSchema = new Schema<IntentTriggeringInfoDocument>({
	context: {
		messages: [MessageSchema],
	},
	intent: {
		name: { type: String, required: true },
		description: { type: String, required: true },
	},
});

export const IntentTriggeringInfoModel =
	mongoose.model<IntentTriggeringInfoDocument>(
		"IntentTriggeringInfo",
		IntentTriggeringInfoSchema,
	);
