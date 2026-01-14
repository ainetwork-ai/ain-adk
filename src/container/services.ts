import {
	getA2AModule,
	getMCPModule,
	getMemoryModule,
	getModelModule,
} from "@/config/modules";
import { getOnIntentFallback } from "@/config/options";
import { A2AService } from "@/services/a2a.service";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import { IntentTriggerService } from "@/services/intents/trigger.service";
import { QueryService } from "@/services/query.service";
import { ThreadService } from "@/services/thread.service";

/**
 * Service factory for dependency injection.
 * Manages singleton instances of all services.
 */
export class ServiceContainer {
	private _threadService?: ThreadService;
	private _intentTriggerService?: IntentTriggerService;
	private _intentFulfillService?: IntentFulfillService;
	private _queryService?: QueryService;
	private _a2aService?: A2AService;

	getThreadService(): ThreadService {
		if (!this._threadService) {
			this._threadService = new ThreadService(getMemoryModule());
		}
		return this._threadService;
	}

	getIntentTriggerService(): IntentTriggerService {
		if (!this._intentTriggerService) {
			this._intentTriggerService = new IntentTriggerService(
				getModelModule(),
				getMemoryModule(),
			);
		}
		return this._intentTriggerService;
	}

	getIntentFulfillService(): IntentFulfillService {
		if (!this._intentFulfillService) {
			this._intentFulfillService = new IntentFulfillService(
				getModelModule(),
				getA2AModule(),
				getMCPModule(),
				getMemoryModule(),
				getOnIntentFallback(),
			);
		}
		return this._intentFulfillService;
	}

	getQueryService(): QueryService {
		if (!this._queryService) {
			this._queryService = new QueryService(
				getModelModule(),
				getMemoryModule(),
				this.getIntentTriggerService(),
				this.getIntentFulfillService(),
			);
		}
		return this._queryService;
	}

	getA2AService(): A2AService {
		if (!this._a2aService) {
			this._a2aService = new A2AService(this.getQueryService());
		}
		return this._a2aService;
	}

	reset(): void {
		this._threadService = undefined;
		this._intentTriggerService = undefined;
		this._intentFulfillService = undefined;
		this._queryService = undefined;
		this._a2aService = undefined;
	}
}
