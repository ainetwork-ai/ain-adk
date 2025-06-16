export class IntentAnalyzer {
  constructor() {
  }

  public async handleQuery(query: any): Promise<any> {
    return new Promise((resolve) => {
      resolve("response");
    });
  };
}