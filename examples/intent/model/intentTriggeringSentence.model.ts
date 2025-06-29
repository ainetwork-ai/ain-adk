import mongoose, { Schema, Document, Types } from "mongoose";

export interface IntentTriggeringSentenceDocument extends Document {
  intent: Types.ObjectId;
  sentence: string;
}

const IntentTriggeringSentenceSchema = new Schema<IntentTriggeringSentenceDocument>({
  intent: { type: Schema.Types.ObjectId, ref: "Intent", required: true },
  sentence: { type: String, required: true },
});

export const IntentTriggeringSentenceModel = mongoose.model<IntentTriggeringSentenceDocument>(
  "IntentTriggeringSentence",
  IntentTriggeringSentenceSchema
); 