import {
	getA2AModule,
	getMCPModule,
	getMemoryModule,
	getModelModule,
} from "@/config/modules";
import { getOnIntentFallback } from "@/config/options";
import { AgentApiController } from "@/controllers/api/agent.api.controller";
import { DocumentApiController } from "@/controllers/api/document.api.controller";
import { IntentApiController } from "@/controllers/api/intent.api.controller";
import { ModelApiController } from "@/controllers/api/model.api.controller";
import { ThreadApiController } from "@/controllers/api/threads.api.controller";
import { UserWorkflowApiController } from "@/controllers/api/user-workflow.api.controller";
import { WorkflowTemplateApiController } from "@/controllers/api/workflow-template.api.controller";
import { IntentController } from "@/controllers/intent.controller";
import { QueryController } from "@/controllers/query.controller";
import { A2AService } from "@/services/a2a.service";
import { DocumentAdviceService } from "@/services/document-advice.service";
import { IntentFulfillService } from "@/services/intents/fulfill.service";
import { IntentTriggerService } from "@/services/intents/trigger.service";
import { PIIService } from "@/services/pii.service";
import { QueryService } from "@/services/query.service";
import { SchedulerService } from "@/services/scheduler.service";
import { ThreadService } from "@/services/thread.service";
import { ToolCallingService } from "@/services/tool-calling.service";
import { UserWorkflowService } from "@/services/user-workflow.service";
import { UserWorkflowCoordinatorService } from "@/services/user-workflow-coordinator.service";
import { WorkflowExecutionService } from "@/services/workflow-execution.service";
import { WorkflowVariableResolver } from "@/services/workflow-variable-resolver.service";

/**
 * Dependency Injection Container
 *
 * Provides singleton instances of services and controllers with proper dependency injection.
 */
class Container {
	// Services
	private _threadService?: ThreadService;
	private _intentTriggerService?: IntentTriggerService;
	private _intentFulfillService?: IntentFulfillService;
	private _queryService?: QueryService;
	private _a2aService?: A2AService;
	private _piiService?: PIIService;
	private _toolCallingService?: ToolCallingService;
	private _userWorkflowService?: UserWorkflowService;
	private _userWorkflowCoordinatorService?: UserWorkflowCoordinatorService;
	private _workflowExecutionService?: WorkflowExecutionService;
	private _workflowVariableResolver?: WorkflowVariableResolver;
	private _schedulerService?: SchedulerService;
	private _documentAdviceService?: DocumentAdviceService;

	// Controllers
	private _queryController?: QueryController;
	private _intentController?: IntentController;
	private _modelApiController?: ModelApiController;
	private _agentApiController?: AgentApiController;
	private _threadApiController?: ThreadApiController;
	private _intentApiController?: IntentApiController;
	private _workflowTemplateApiController?: WorkflowTemplateApiController;
	private _userWorkflowApiController?: UserWorkflowApiController;
	private _documentApiController?: DocumentApiController;

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

	getToolCallingService(): ToolCallingService {
		if (!this._toolCallingService) {
			this._toolCallingService = new ToolCallingService(
				getModelModule(),
				getA2AModule(),
				getMCPModule(),
			);
		}
		return this._toolCallingService;
	}

	getIntentFulfillService(): IntentFulfillService {
		if (!this._intentFulfillService) {
			this._intentFulfillService = new IntentFulfillService(
				getModelModule(),
				getMemoryModule(),
				this.getToolCallingService(),
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
				getModelModule(),
				getMemoryModule(),
				this.getToolCallingService(),
				getA2AModule(),
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

	getQueryController(): QueryController {
		if (!this._queryController) {
			this._queryController = new QueryController(this.getQueryService());
		}
		return this._queryController;
	}

	getIntentController(): IntentController {
		if (!this._intentController) {
			this._intentController = new IntentController(
				this.getThreadService(),
				this.getIntentTriggerService(),
			);
		}
		return this._intentController;
	}

	getModelApiController(): ModelApiController {
		if (!this._modelApiController) {
			this._modelApiController = new ModelApiController(getModelModule());
		}
		return this._modelApiController;
	}

	getAgentApiController(): AgentApiController {
		if (!this._agentApiController) {
			this._agentApiController = new AgentApiController(getA2AModule());
		}
		return this._agentApiController;
	}

	getThreadApiController(): ThreadApiController {
		if (!this._threadApiController) {
			this._threadApiController = new ThreadApiController(getMemoryModule());
		}
		return this._threadApiController;
	}

	getIntentApiController(): IntentApiController {
		if (!this._intentApiController) {
			this._intentApiController = new IntentApiController(getMemoryModule());
		}
		return this._intentApiController;
	}

	getWorkflowTemplateApiController(): WorkflowTemplateApiController {
		if (!this._workflowTemplateApiController) {
			this._workflowTemplateApiController = new WorkflowTemplateApiController(
				getMemoryModule(),
			);
		}
		return this._workflowTemplateApiController;
	}

	getUserWorkflowApiController(): UserWorkflowApiController {
		if (!this._userWorkflowApiController) {
			this._userWorkflowApiController = new UserWorkflowApiController(
				this.getUserWorkflowService(),
				this.getUserWorkflowCoordinatorService(),
				this.getWorkflowExecutionService(),
				this.getQueryService(),
			);
		}
		return this._userWorkflowApiController;
	}

	getDocumentAdviceService(): DocumentAdviceService {
		if (!this._documentAdviceService) {
			this._documentAdviceService = new DocumentAdviceService(
				getModelModule(),
				getMemoryModule(),
			);
		}
		return this._documentAdviceService;
	}

	getDocumentApiController(): DocumentApiController {
		if (!this._documentApiController) {
			this._documentApiController = new DocumentApiController(
				getMemoryModule(),
				this.getWorkflowExecutionService(),
				this.getDocumentAdviceService(),
			);
		}
		return this._documentApiController;
	}

	/**
	 * Reset all instances (useful for testing)
	 */
	reset(): void {
		this._threadService = undefined;
		this._intentTriggerService = undefined;
		this._intentFulfillService = undefined;
		this._queryService = undefined;
		this._a2aService = undefined;
		this._piiService = undefined;
		this._toolCallingService = undefined;
		this._userWorkflowService = undefined;
		this._userWorkflowCoordinatorService = undefined;
		this._workflowExecutionService = undefined;
		this._workflowVariableResolver = undefined;
		this._schedulerService = undefined;
		this._documentAdviceService = undefined;

		this._queryController = undefined;
		this._intentController = undefined;
		this._modelApiController = undefined;
		this._agentApiController = undefined;
		this._threadApiController = undefined;
		this._intentApiController = undefined;
		this._workflowTemplateApiController = undefined;
		this._userWorkflowApiController = undefined;
		this._documentApiController = undefined;
	}
}

export const container = new Container();
