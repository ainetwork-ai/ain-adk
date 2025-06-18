import { IntentAnalyzer } from "@/intent/analyzer.js";
import { AgentExecutor, ExecutionEventBus, RequestContext, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { AgentExecutionEvent } from "@a2a-js/sdk/build/src/server/events/execution_event_bus.js";

import { v4 as uuidv4 } from 'uuid';

export class AINAgentExecutor implements AgentExecutor {
  private intentAnalyzer: IntentAnalyzer;
  private cancelledTasks: Set<string> = new Set<string>();

  constructor(intentAnalyzer: IntentAnalyzer) {
    this.intentAnalyzer = intentAnalyzer;
  }

  public cancelTask = async (
    taskId: string,
    _eventBus: ExecutionEventBus
  ): Promise<void> => {
    this.cancelledTasks.add(taskId);
  }

  private createTaskStatusUpdateEvent = (
    taskId: string,
    contextId: string,
    state: 'working' | 'failed' | 'canceled' | 'completed',
    message: string,
  ): TaskStatusUpdateEvent => {
    return {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: state,
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: message }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: state !== 'working',
    };
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    const taskId = existingTask?.id || uuidv4();
    const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: AgentExecutionEvent = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
        artifacts: [],
      }
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate = this.createTaskStatusUpdateEvent(
      taskId,
      contextId,
      'working',
      'Processing your question, hang tight!'
    );
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare message for intent analyzer
    // TODO: Multi-modal (part.kind === 'file' || part.kind === 'data')
    // TODO: Context history management
    // TODO: anything else?
    const message: string = userMessage.parts.filter(part => part.kind === 'text').map(part => part.text).join('\n');
    if (message.length === 0) {
      console.warn(`Empty message received for task ${taskId}.`);
      const failureUpdate = this.createTaskStatusUpdateEvent(
        taskId,
        contextId,
        'failed',
        'No message found to process.'
      );
      eventBus.publish(failureUpdate);
      return;
    }

    // 4. Handle query using intent analyzer
    try {
      const response = await this.intentAnalyzer.handleQuery(message);

      const finalUpdate = this.createTaskStatusUpdateEvent(
        taskId,
        contextId,
        'completed',
        response.content    // FIXME: only for Azure OpenAI fetch
      );
      eventBus.publish(finalUpdate);
      console.log(`Task ${taskId} completed successfully.`);
    } catch (error: any) {
      console.error(`Error processing task ${taskId}:`, error);
      const errorUpdate = this.createTaskStatusUpdateEvent(
        taskId,
        contextId,
        'failed',
        `Agent error: ${error.message}`
      );
      eventBus.publish(errorUpdate);
      return;
    }
  }
}