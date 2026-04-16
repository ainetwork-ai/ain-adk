import {
	getA2AModule,
	getArtifactModule,
	getMCPModule,
	getMemoryModule,
	getModelModule,
} from "@/config/modules";
import { getOnIntentFallback } from "@/config/options";
import { A2AService } from "@/services/a2a.service";
import { ArtifactService } from "@/services/artifact.service";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import { IntentTriggerService } from "@/services/intents/trigger.service";
import { PIIService } from "@/services/pii.service";
import { QueryService } from "@/services/query.service";
import { SchedulerService } from "@/services/scheduler.service";
import { ThreadService } from "@/services/thread.service";
import { UserWorkflowService } from "@/services/user-workflow.service";
import { UserWorkflowCoordinatorService } from "@/services/user-workflow-coordinator.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";

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
	private _piiService?: PIIService;
	private _artifactService?: ArtifactService;
	private _userWorkflowService?: UserWorkflowService;
	private _userWorkflowCoordinatorService?: UserWorkflowCoordinatorService;
	private _workflowExecutionService?: WorkflowExecutionService;
	private _workflowVariableResolver?: WorkflowVariableResolver;
	private _schedulerService?: SchedulerService;

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

	getPIIService(): PIIService {
		if (!this._piiService) {
			this._piiService = new PIIService(getModelModule(), getMemoryModule());
		}
		return this._piiService;
	}

	getIntentFulfillService(): IntentFulfillService {
		if (!this._intentFulfillService) {
			this._intentFulfillService = new IntentFulfillService(
				getModelModule(),
				getMemoryModule(),
				getA2AModule(),
				getMCPModule(),
				getOnIntentFallback(),
				this.getPIIService(),
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
				this.getPIIService(),
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

	getArtifactService(): ArtifactService {
		if (!this._artifactService) {
			this._artifactService = new ArtifactService(getArtifactModule());
		}
		return this._artifactService;
	}

	getUserWorkflowService(): UserWorkflowService {
		if (!this._userWorkflowService) {
			this._userWorkflowService = new UserWorkflowService(
				getMemoryModule(),
				this.getWorkflowVariableResolver(),
			);
		}
		return this._userWorkflowService;
	}

	getUserWorkflowCoordinatorService(): UserWorkflowCoordinatorService {
		if (!this._userWorkflowCoordinatorService) {
			this._userWorkflowCoordinatorService = new UserWorkflowCoordinatorService(
				this.getUserWorkflowService(),
				this.getSchedulerService(),
			);
		}
		return this._userWorkflowCoordinatorService;
	}

	getWorkflowExecutionService(): WorkflowExecutionService {
		if (!this._workflowExecutionService) {
			this._workflowExecutionService = new WorkflowExecutionService(
				this.getUserWorkflowService(),
				this.getQueryService(),
				this.getWorkflowVariableResolver(),
			);
		}
		return this._workflowExecutionService;
	}

	getWorkflowVariableResolver(): WorkflowVariableResolver {
		if (!this._workflowVariableResolver) {
			this._workflowVariableResolver = new WorkflowVariableResolver();
		}
		return this._workflowVariableResolver;
	}

	getSchedulerService(): SchedulerService {
		if (!this._schedulerService) {
			this._schedulerService = new SchedulerService(
				this.getUserWorkflowService(),
				this.getWorkflowExecutionService(),
			);
		}
		return this._schedulerService;
	}

	reset(): void {
		this._threadService = undefined;
		this._intentTriggerService = undefined;
		this._intentFulfillService = undefined;
		this._queryService = undefined;
		this._a2aService = undefined;
		this._piiService = undefined;
		this._artifactService = undefined;
		this._userWorkflowService = undefined;
		this._userWorkflowCoordinatorService = undefined;
		this._workflowExecutionService = undefined;
		this._workflowVariableResolver = undefined;
		this._schedulerService = undefined;
	}
}
