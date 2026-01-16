import {
	getA2AModule,
	getMemoryModule,
	getModelModule,
} from "@/config/modules";
import { AgentApiController } from "@/controllers/api/agent.api.controller";
import { IntentApiController } from "@/controllers/api/intent.api.controller";
import { ModelApiController } from "@/controllers/api/model.api.controller";
import { ThreadApiController } from "@/controllers/api/threads.api.controller";
import { WorkflowApiController } from "@/controllers/api/workflow.api.controller";
import { IntentController } from "@/controllers/intent.controller";
import { QueryController } from "@/controllers/query.controller";
import type { ServiceContainer } from "./services";

/**
 * Controller factory for dependency injection.
 * Manages singleton instances of all controllers.
 */
export class ControllerContainer {
	private services: ServiceContainer;

	private _queryController?: QueryController;
	private _intentController?: IntentController;
	private _modelApiController?: ModelApiController;
	private _agentApiController?: AgentApiController;
	private _threadApiController?: ThreadApiController;
	private _intentApiController?: IntentApiController;
	private _workflowApiController?: WorkflowApiController;

	constructor(services: ServiceContainer) {
		this.services = services;
	}

	getQueryController(): QueryController {
		if (!this._queryController) {
			this._queryController = new QueryController(
				this.services.getQueryService(),
			);
		}
		return this._queryController;
	}

	getIntentController(): IntentController {
		if (!this._intentController) {
			this._intentController = new IntentController(
				this.services.getThreadService(),
				this.services.getIntentTriggerService(),
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

	getWorkflowApiController(): WorkflowApiController {
		if (!this._workflowApiController) {
			this._workflowApiController = new WorkflowApiController(
				getMemoryModule(),
			);
		}
		return this._workflowApiController;
	}

	reset(): void {
		this._queryController = undefined;
		this._intentController = undefined;
		this._modelApiController = undefined;
		this._agentApiController = undefined;
		this._threadApiController = undefined;
		this._intentApiController = undefined;
		this._workflowApiController = undefined;
	}
}
