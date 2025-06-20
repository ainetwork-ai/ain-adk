import { Application } from "express";

import { A2AError, A2AResponse, DefaultRequestHandler, InMemoryTaskStore, JSONRPCErrorResponse, JSONRPCSuccessResponse, JsonRpcTransportHandler, TaskStore } from "@a2a-js/sdk";
import { AINAgentExecutor } from "./executor.js";
import { Request, Response } from "express";
import { IntentAnalyzer } from "@/intent/analyzer.js";
import { loggers } from "@/utils/logger.js";

export class A2AServer {
  private taskStore: TaskStore;
  private agentExecutor: AINAgentExecutor;
  private requestHandler: DefaultRequestHandler;
  private jsonRpcTransportHandler: JsonRpcTransportHandler;

  constructor(intentAnalyzer: IntentAnalyzer) {
    this.taskStore = new InMemoryTaskStore();
    this.agentExecutor = new AINAgentExecutor(intentAnalyzer);
    this.requestHandler = new DefaultRequestHandler(
      intentAnalyzer.buildAgentCard(),
      this.taskStore,
      this.agentExecutor
    );
    this.jsonRpcTransportHandler = new JsonRpcTransportHandler(this.requestHandler);
  }

  public setupRoutes(app: Application) {
    app.get('/agent-card', async (_, res: Response) => {
      const agentCard = await this.requestHandler.getAgentCard();
      res.json(agentCard);
    });

    app.get('/.well-known/agent.json', async (_, res: Response) => {
      const agentCard = await this.requestHandler.getAgentCard();
      res.json(agentCard);
    });

    app.post('/a2a', async (req: Request, res: Response) => {
      try {
        const rpcResponseOrStream = await this.jsonRpcTransportHandler.handle(req.body);
        // Check if it's an AsyncGenerator (stream)
        if (typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] === 'function') {
          const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();

          try {
            for await (const event of stream) {
              // Each event from the stream is already a JSONRPCResult
              res.write(`id: ${new Date().getTime()}\n`);
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          } catch (streamError: any) {
            loggers.server.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
            // If the stream itself throws an error, send a final JSONRPCErrorResponse
            const a2aError = streamError instanceof A2AError ? streamError : A2AError.internalError(streamError.message || 'Streaming error.');
            const errorResponse: JSONRPCErrorResponse = {
              jsonrpc: '2.0',
              id: req.body?.id || null, // Use original request ID if available
              error: a2aError.toJSONRPCError(),
            };
            if (!res.headersSent) { // Should not happen if flushHeaders worked
              res.status(500).json(errorResponse); // Should be JSON, not SSE here
            } else {
              // Try to send as last SSE event if possible, though client might have disconnected
              res.write(`id: ${new Date().getTime()}\n`);
              res.write(`event: error\n`); // Custom event type for client-side handling
              res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
            }
          } finally {
            if (!res.writableEnded) {
              res.end();
            }
          }
        } else { // Single JSON-RPC response
          const rpcResponse = rpcResponseOrStream as A2AResponse;
          res.status(200).json(rpcResponse);
        }
      } catch (error: any) { // Catch errors from jsonRpcTransportHandler.handle itself (e.g., initial parse error)
        loggers.server.error("Unhandled error in AINAgent A2A POST handler:", error);
        const a2aError = error instanceof A2AError ? error : A2AError.internalError('General processing error.');
        const errorResponse: JSONRPCErrorResponse = {
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: a2aError.toJSONRPCError(),
        };
        if (!res.headersSent) {
          res.status(500).json(errorResponse);
        } else if (!res.writableEnded) {
          // If headers sent (likely during a stream attempt that failed early), try to end gracefully
          res.end();
        }
      }
    });
  }
}