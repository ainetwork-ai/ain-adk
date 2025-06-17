import express from 'express';
import cors from 'cors';

import { BaseAuth } from './modules/auth/base.js';
import { A2AServer } from './modules/a2a/a2aServer.js';
import { BaseModel } from './modules/models/base.js';
import { IntentAnalyzer } from './modules/intent/analyzer.js';
import { MCPToolset } from './modules/mcp/toolset.js';

export class AINAgent {
  public app: express.Application;

  // Modules
  private authScheme?: BaseAuth;
  private mcpToolset: MCPToolset;
  private a2aServer: A2AServer;
  private intentAnalyzer?: IntentAnalyzer;

  constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    this.mcpToolset = new MCPToolset();
    this.a2aServer = new A2AServer();
  }
  
  public addIntentAnalyzer(intentAnalyzer: IntentAnalyzer): void {
    this.intentAnalyzer = intentAnalyzer;
  } 

  public start(port: number): void {
    if (this.authScheme) {
      this.app.use(this.authScheme.middleware());
    }

    this.app.get('/', (req, res) => {
      res.send('Welcome to AINAgent!');
    });

    if (!this.intentAnalyzer) {
      throw new Error('IntentAnalyzer is not set. Please set it before starting the server.');
    }
    this.app.post('/query', async (req, res) => {
      const { message } = req.body;

      // TODO: Handle query type
      const response = await this.intentAnalyzer?.handleQuery(message);
      res.json(response);
    });

    if (this.a2aServer.getAgentCard()) {
      this.app.post('/a2a', (req, res) => { /* FIXME */ })
      this.app.get('/agent-card', (req, res) => {
        res.json(this.a2aServer.getAgentCard());
      });
    }

    this.app.listen(port, () => {
      console.log(`AINAgent is running on port ${port}`);
    });
  }
}