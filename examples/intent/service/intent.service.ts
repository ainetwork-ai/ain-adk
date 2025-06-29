import { IntentRepository } from "../repository/intent.repository";
import { IntentTriggeringSentenceRepository } from "../repository/intentTriggeringSentence.repository";
import type { ADKIntent } from "../../../src/intent/modules/intent/types.js";

export class IntentService {
  constructor(
    private intentRepo = new IntentRepository(),
    private triggerRepo = new IntentTriggeringSentenceRepository()
  ) {}

  async findAllWithTriggerSentences(): Promise<ADKIntent[]> {
    const intents = await this.intentRepo.findAll();
    return Promise.all(
      intents.map(async (intent) => {
        const triggerSentences = await this.triggerRepo.findByIntentId(String(intent._id));
        return {
          id: String(intent._id),
          name: intent.name,
          description: intent.description,
          triggerSentences: triggerSentences.map(ts => ts.sentence),
        };
      })
    );
  }
} 