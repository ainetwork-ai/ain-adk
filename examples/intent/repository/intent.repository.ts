import { IntentModel, IntentDocument } from "../model/intent.model";

export class IntentRepository {
  async create(intent: Omit<IntentDocument, "_id">) {
    return IntentModel.create(intent);
  }

  async findAll() {
    return IntentModel.find();
  }

  async findById(id: string) {
    return IntentModel.findById(id);
  }
} 