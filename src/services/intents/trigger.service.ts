import type { MemoryModule, ModelModule } from "@/modules";
import type { IntentTriggerResult, ThreadObject } from "@/types/memory";
import { MultiIntentTriggerService } from "./multi-trigger.service";
import { SingleIntentTriggerService } from "./single-trigger.service";

/**
 * Check if multi-intent is disabled via environment variable.
 */
function isMultiIntentDisabled(): boolean {
	const value = process.env.DISABLE_MULTI_INTENTS;
	return value === "true" || value === "1";
}

/**
 * Service for intent triggering.
 * Routes to single or multi-intent triggering based on DISABLE_MULTI_INTENTS env var.
 */
export class IntentTriggerService {
	private singleTriggerService: SingleIntentTriggerService;
	private multiTriggerService: MultiIntentTriggerService;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.singleTriggerService = new SingleIntentTriggerService(
			modelModule,
			memoryModule,
		);
		this.multiTriggerService = new MultiIntentTriggerService(
			modelModule,
			memoryModule,
		);
	}

	/**
	 * Detects the intent from context.
	 * Routes to single or multi-intent triggering based on DISABLE_MULTI_INTENTS env var.
	 *
	 * @param query - The user's input query
	 * @param thread - The thread history
	 * @returns IntentTriggerResult containing intents and aggregation flag
	 */
	public async intentTriggering(
		query: string,
		thread: ThreadObject | undefined,
	): Promise<IntentTriggerResult> {
		if (isMultiIntentDisabled()) {
			return this.singleTriggerService.intentTriggering(query, thread);
		}
		return this.multiTriggerService.intentTriggering(query, thread);
	}
}
