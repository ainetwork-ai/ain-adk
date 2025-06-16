export abstract class IntentAnalyzer {
  constructor() {
  }

  abstract handleQuery(query: any): Promise<any>;
}