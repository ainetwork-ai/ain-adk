import { AINAgent } from "@/index";
import { getArtifactModule } from "@/config/modules";
import { A2AModule } from "@/modules/a2a/a2a.module";
import { ArtifactModule } from "@/modules/artifacts/artifact.module";
import type { IArtifactStore } from "@/modules/artifacts/base.artifact";
import { AuthModule } from "@/modules/auth/auth.module";
import { MemoryModule } from "@/modules/memory/memory.module";
import type {
	IAgentMemory,
	IIntentMemory,
	IMemory,
	IThreadMemory,
	IUserWorkflowMemory,
	IWorkflowTemplateMemory,
} from "@/modules/memory/base.memory";
import { BaseModel } from "@/modules/models/base.model";
import { ModelModule } from "@/modules/models/model.module";
import type { AuthResponse } from "@/types/auth";
import type { ConnectorTool, FetchResponse } from "@/types/connector";
import type {
	Intent,
	ThreadMetadata,
	UserWorkflow,
	WorkflowTemplate,
} from "@/types/memory";
import type { LLMStream } from "@/types/stream";

class TestAuthModule extends AuthModule {
	async authenticate(): Promise<AuthResponse> {
		return {
			isAuthenticated: true,
			userId: "test-user",
		};
	}
}

class TestModel extends BaseModel<string, string> {
	generateMessages(): string[] {
		return [];
	}

	appendMessages(): void {}

	convertToolsToFunctions(_tools: ConnectorTool[]): string[] {
		return [];
	}

	async fetch(): Promise<FetchResponse> {
		return { content: "" };
	}

	async fetchWithContextMessage(): Promise<FetchResponse> {
		return { content: "" };
	}

	async fetchStreamWithContextMessage(): Promise<LLMStream> {
		return {
			async *[Symbol.asyncIterator]() {},
		};
	}
}

const threadMemory: IThreadMemory = {
	getThread: jest.fn(),
	createThread: jest.fn(),
	addMessagesToThread: jest.fn(),
	deleteThread: jest.fn(),
	listThreads: jest.fn<Promise<ThreadMetadata[]>, []>().mockResolvedValue([]),
	updateThreadPin: jest.fn(),
};

const intentMemory: IIntentMemory = {
	getIntent: jest.fn<Promise<Intent | undefined>, [string]>(),
	getIntentByName: jest.fn<Promise<Intent | undefined>, [string]>(),
	saveIntent: jest.fn(),
	updateIntent: jest.fn(),
	deleteIntent: jest.fn(),
	listIntents: jest.fn<Promise<Intent[]>, []>().mockResolvedValue([]),
};

const agentMemory: IAgentMemory = {
	getAgentPrompt: jest.fn<Promise<string>, []>().mockResolvedValue(""),
};

const workflowTemplateMemory: IWorkflowTemplateMemory = {
	getTemplate: jest.fn<Promise<WorkflowTemplate | undefined>, [string]>(),
	createTemplate: jest.fn(),
	updateTemplate: jest.fn(),
	deleteTemplate: jest.fn(),
	listTemplates: jest.fn<Promise<WorkflowTemplate[]>, []>().mockResolvedValue([]),
};

const userWorkflowMemory: IUserWorkflowMemory = {
	getUserWorkflow: jest.fn<Promise<UserWorkflow | undefined>, [string]>(),
	createUserWorkflow: jest.fn(),
	updateUserWorkflow: jest.fn(),
	deleteUserWorkflow: jest.fn(),
	listUserWorkflows: jest.fn<Promise<UserWorkflow[]>, []>().mockResolvedValue([]),
	listActiveScheduledWorkflows: jest
		.fn<Promise<UserWorkflow[]>, []>()
		.mockResolvedValue([]),
};

class TestMemory implements IMemory {
	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	isConnected(): boolean {
		return true;
	}

	getThreadMemory(): IThreadMemory {
		return threadMemory;
	}

	getIntentMemory(): IIntentMemory {
		return intentMemory;
	}

	getAgentMemory(): IAgentMemory {
		return agentMemory;
	}

	getWorkflowTemplateMemory(): IWorkflowTemplateMemory {
		return workflowTemplateMemory;
	}

	getUserWorkflowMemory(): IUserWorkflowMemory {
		return userWorkflowMemory;
	}
}

describe("AINAgent artifact module wiring", () => {
	it("registers the optional artifact module in the agent and module registry", () => {
		const modelModule = new ModelModule();
		modelModule.addModel("test-model", new TestModel(), {}, true);

		const artifactStore: IArtifactStore = {
			put: jest.fn(),
			get: jest.fn(),
			delete: jest.fn(),
			openDownload: jest.fn(),
		};
		const artifactModule = new ArtifactModule(artifactStore);

		const agent = new AINAgent(
			{
				name: "Test Agent",
				description: "Test agent for artifact module wiring",
			},
			{
				authModule: new TestAuthModule(),
				modelModule,
				memoryModule: new MemoryModule(new TestMemory()),
				artifactModule,
			},
		);

		expect(agent.artifactModule).toBe(artifactModule);
		expect(getArtifactModule()).toBe(artifactModule);
		expect(getArtifactModule()?.getStore()).toBe(artifactStore);
	});

	it("publishes an A2A agent card with streaming and artifact-aware modes", () => {
		const modelModule = new ModelModule();
		modelModule.addModel("test-model", new TestModel(), {}, true);

		const artifactStore: IArtifactStore = {
			put: jest.fn(),
			get: jest.fn(),
			delete: jest.fn(),
			openDownload: jest.fn(),
		};
		const artifactModule = new ArtifactModule(artifactStore);
		const a2aModule = new A2AModule();

		const agent = new AINAgent(
			{
				name: "Test Agent",
				description: "Test agent for A2A card generation",
				url: "https://example.com/agent",
			},
			{
				authModule: new TestAuthModule(),
				modelModule,
				memoryModule: new MemoryModule(new TestMemory()),
				artifactModule,
				a2aModule,
			},
		);

		const card = agent.generateAgentCard();
		expect(card).toMatchObject({
			name: "Test Agent",
			description: "Test agent for A2A card generation",
			url: "https://example.com/a2a",
			preferredTransport: "JSONRPC",
			defaultInputModes: ["text", "data", "file"],
			defaultOutputModes: ["text", "data", "file"],
			capabilities: {
				streaming: true,
				pushNotifications: false,
				stateTransitionHistory: true,
			},
			additionalInterfaces: [
				{
					url: "https://example.com/a2a",
					transport: "JSONRPC",
				},
			],
			skills: [
				{
					id: "query",
					name: "Test Agent",
					inputModes: ["text", "data", "file"],
					outputModes: ["text", "data", "file"],
				},
			],
		});
	});
});
