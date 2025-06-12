import express from 'express';
import { BaseAuth } from './auth/base.js';

export class AINAgent {
  public app: express.Application;
  private isA2AServer: boolean = false;

  constructor() {
    this.app = express();
  }

  public setAuthScheme(authScheme: BaseAuth): void {
    this.app.use(authScheme.middleware());
  }

  public start(port: number): void {
    this.app.listen(port, () => {
      console.log(`AINAgent is running on port ${port}`);
    });
  }
}