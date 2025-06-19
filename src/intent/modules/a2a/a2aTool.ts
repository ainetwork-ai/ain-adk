import { AgentCard } from "@a2a-js/sdk";
import { AgentTool } from "../common/tool.js";
import { PROTOCOL_TYPE } from "../common/types.js";

export class A2ATool extends AgentTool {
  public agentCard: AgentCard;

  constructor(card: AgentCard) {
    super(card.name, PROTOCOL_TYPE.MCP);
    this.agentCard = card;
  }
}
