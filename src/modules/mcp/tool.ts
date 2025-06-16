export class MCPTool {
  public name: string;
  public description: string;
  public enabled: boolean;

  constructor(
    name: string,
    description: string,
  ) {
    this.name = name;
    this.description = description;
    this.enabled = true;
  }

  public enable(): void {
    this.enabled = true;
  }

  public disable(): void {
    this.enabled = false;
  }
}