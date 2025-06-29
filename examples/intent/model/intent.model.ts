import mongoose, { Schema, Document } from "mongoose";

export interface IntentDocument extends Document {
  name: string;
  description: string;
}

const IntentSchema = new Schema<IntentDocument>({
  name: { type: String, required: true },
  description: { type: String, required: true },
});

export const IntentModel = mongoose.model<IntentDocument>("Intent", IntentSchema); 