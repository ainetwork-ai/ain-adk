import { PROTOCOL_TYPE } from "./types.js";

export class AgentTool {
  public id: string;  // MCP: `<serverName>_<toolName>` ex) notionApi_API-post-search
  public protocol: PROTOCOL_TYPE;
  public enabled: boolean;

  constructor(id: string, protocol: PROTOCOL_TYPE) {
    this.id = id;
    this.protocol = protocol;
    this.enabled = true;
  }

  public enable(): void {
    this.enabled = true;
  }

  public disable(): void {
    this.enabled = false;
  }
}