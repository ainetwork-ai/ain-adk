import { IntentTriggeringSentenceModel, IntentTriggeringSentenceDocument } from "../model/intentTriggeringSentence.model";

export class IntentTriggeringSentenceRepository {
  async create(data: Omit<IntentTriggeringSentenceDocument, "_id">) {
    return IntentTriggeringSentenceModel.create(data);
  }

  async findByIntentId(intentId: string) {
    return IntentTriggeringSentenceModel.find({ intent: intentId });
  }
} 