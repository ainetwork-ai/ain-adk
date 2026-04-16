import {
	getA2AModule,
	getMemoryModule,
	getModelModule,
} from "@/config/modules";
import { AgentApiController } from "@/controllers/api/agent.api.controller";
import { ArtifactApiController } from "@/controllers/api/artifact.api.controller";
import { IntentApiController } from "@/controllers/api/intent.api.controller";
import { ModelApiController } from "@/controllers/api/model.api.controller";
import { ThreadApiController } from "@/controllers/api/threads.api.controller";
import { UserWorkflowApiController } from "@/controllers/api/user-workflow.api.controller";
import { WorkflowTemplateApiController } from "@/controllers/api/workflow-template.api.controller";
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
	private _artifactApiController?: ArtifactApiController;
	private _threadApiController?: ThreadApiController;
	private _intentApiController?: IntentApiController;
	private _workflowTemplateApiController?: WorkflowTemplateApiController;
	private _userWorkflowApiController?: UserWorkflowApiController;

	constructor(services: ServiceContainer) {
		this.services = services;
	}

	getQueryController(): QueryController {
		if (!this._queryController) {
			this._queryController = new QueryController(
				this.services.getQueryService(),
				this.services.getArtifactService(),
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

	getArtifactApiController(): ArtifactApiController {
		if (!this._artifactApiController) {
			this._artifactApiController = new ArtifactApiController(
				this.services.getArtifactService(),
			);
		}
		return this._artifactApiController;
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
				this.services.getUserWorkflowService(),
				this.services.getUserWorkflowCoordinatorService(),
			);
		}
		return this._userWorkflowApiController;
	}

	reset(): void {
		this._queryController = undefined;
		this._intentController = undefined;
		this._modelApiController = undefined;
		this._agentApiController = undefined;
		this._artifactApiController = undefined;
		this._threadApiController = undefined;
		this._intentApiController = undefined;
		this._workflowTemplateApiController = undefined;
		this._userWorkflowApiController = undefined;
	}
}
