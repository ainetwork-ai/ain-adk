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
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: "working",
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your question, hang tight!' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);
  }
}