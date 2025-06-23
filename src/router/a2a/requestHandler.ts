import type {
	AgentCard,
	AgentExecutor,
	ExecutionEventBusManager,
	TaskStore,
} from "@a2a-js/sdk";
import {
	DefaultExecutionEventBusManager,
	DefaultRequestHandler,
} from "@a2a-js/sdk";

export class AINRequestHandler extends DefaultRequestHandler {
	private ainAgentCard: AgentCard;

	constructor(
		card: AgentCard,
		taskStore: TaskStore,
		executor: AgentExecutor,
		eventBusManager: ExecutionEventBusManager = new DefaultExecutionEventBusManager(),
	) {
		super(card, taskStore, executor, eventBusManager);
		this.ainAgentCard = card;
	}

	async getAgentCard(): Promise<AgentCard> {
		return this.ainAgentCard;
	}

	async updateAgentCard(): Promise<void> {
		const newAgentCard = await super.getAgentCard();
		// TODO: Update skills using mcp tools
		this.ainAgentCard = newAgentCard;
	}
}
