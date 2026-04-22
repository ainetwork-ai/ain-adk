# Workflow Refactor Plan

## Background

The current workflow implementation is intentionally thin: a user workflow stores long-form text, resolves variables, and sends the resolved text through the same `QueryService.handleQuery()` path used by normal chat. This keeps thread and message handling simple, but it also means workflows do not have a first-class structure. A workflow cannot explicitly describe tasks, assign tasks to connected A2A agents, or define the final response shape.

This refactor introduces a well-formed workflow execution model while preserving the existing thread and message management behavior.

## Goals

- Define workflows as structured task and response specifications, not only long text prompts.
- Allow each workflow task to optionally target a connected A2A agent.
- Execute tasks without an A2A target locally.
- Generate the final workflow response from task outputs.
- Support response composition from typed output blocks such as heading, text, and table.
- Keep workflow-created threads and messages compatible with existing chat thread APIs.
- Separate the workflow execution path from the general chat query path.
- Preserve existing scheduled workflow support.
- Provide both non-streaming and streaming workflow execution endpoints.

## Non-Goals

- Do not replace normal chat or intent fulfillment.
- Do not require a graph/DAG engine in the first version.
- Do not change the external memory provider contract more than necessary without a migration path.
- Do not require response blocks to be rendered by the backend as HTML. The backend should return structured metadata and text-friendly output.

## Current State

The important current pieces are:

- `UserWorkflow.content`: stores the prompt text used as the query.
- `WorkflowVariableResolver`: resolves variables for creation/execution.
- `WorkflowExecutionService.executeWorkflow()`: resolves the workflow and calls `QueryService.handleQuery()` with `ThreadType.WORKFLOW`.
- `QueryService.handleQuery()`: creates/loads the thread, stores the user message, triggers intents, fulfills intents, and stores the final model message.
- `SchedulerService`: executes scheduled workflows by calling `WorkflowExecutionService.executeWorkflow()`.

The main problem is that workflow execution is just chat execution with a different query string.

## Proposed Workflow Shape

Add structured fields to `WorkflowTemplate` and `UserWorkflow` while keeping `content` temporarily for backward compatibility.

```ts
export interface WorkflowTask {
  taskId: string;
  title: string;
  prompt: string;
  agent?: WorkflowTaskAgent;
  outputKey?: string;
  dependsOn?: string[];
}

export interface WorkflowTaskAgent {
  protocol: "A2A";
  connectorName: string;
}

export type WorkflowResponseBlock =
  | WorkflowHeadingBlock
  | WorkflowTextBlock
  | WorkflowTableBlock;

export interface WorkflowHeadingBlock {
  blockId: string;
  type: "heading";
  level?: 1 | 2 | 3;
  text: string;
}

export interface WorkflowTextBlock {
  blockId: string;
  type: "text";
  prompt: string;
  sourceTaskIds?: string[];
}

export interface WorkflowTableBlock {
  blockId: string;
  type: "table";
  title?: string;
  columns: Array<{
    key: string;
    label: string;
    source?: string;
  }>;
  sourceTaskIds?: string[];
  prompt?: string;
}

export interface WorkflowDefinition {
  tasks: WorkflowTask[];
  response: {
    blocks: WorkflowResponseBlock[];
  };
}
```

Then extend workflow records:

```ts
export interface WorkflowTemplate {
  templateId: string;
  title: string;
  description: string;
  active: boolean;
  content: string; // legacy
  definition?: WorkflowDefinition;
  variables?: Record<string, WorkflowVariable>;
}

export interface UserWorkflow {
  workflowId: string;
  userId: string;
  title: string;
  description?: string;
  active: boolean;
  templateId?: string;
  content: string; // legacy
  definition?: WorkflowDefinition;
  variables?: Record<string, WorkflowVariable>;
  variableValues?: Record<string, string>;
  schedule?: string;
  timezone?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastThreadId?: string;
}
```

For v1, tasks should execute in list order. `dependsOn` can be accepted in the schema but only validated for simple forward references. A full DAG scheduler can come later.

## Execution Model

Introduce a separate workflow execution pipeline:

```text
WorkflowExecutionService
  -> WorkflowRunContextFactory
  -> WorkflowThreadWriter
  -> WorkflowTaskExecutor
       -> LocalWorkflowTaskExecutor
       -> A2AWorkflowTaskExecutor
  -> WorkflowResponseComposer
  -> WorkflowThreadWriter
```

### WorkflowRunContext

The execution service should build a context object:

```ts
export interface WorkflowRunContext {
  workflow: UserWorkflow;
  thread: ThreadObject;
  executionVariables?: Record<string, string>;
  resolvedDefinition: WorkflowDefinition;
  taskResults: Record<string, WorkflowTaskResult>;
}
```

Variables should be resolved across:

- workflow title
- legacy `content`
- each task prompt
- heading block text
- text block prompt
- table block prompt
- table column source expressions

### Thread Creation

Workflow execution should still create a `ThreadType.WORKFLOW` thread. The thread metadata should keep:

- `userId`
- `threadId`
- `workflowId`
- `title`
- `type: ThreadType.WORKFLOW`

The first stored user message should represent the workflow run, not a giant hidden prompt. Suggested content:

```ts
content: { type: "text", parts: [displayQuery || workflow.title] }
metadata: {
  workflowId,
  workflowRun: true,
  query: resolvedLegacyContentOrSummary,
}
```

This preserves existing thread listing and retrieval behavior while preventing workflow internals from appearing as a normal chat prompt by default.

## Task Execution

### Task Result

Each task execution should produce a structured result:

```ts
export interface WorkflowTaskResult {
  taskId: string;
  title: string;
  agent?: WorkflowTaskAgent;
  status: "completed" | "failed" | "skipped";
  content: string;
  raw?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
}
```

### Local Tasks

A task without `agent` runs locally. Local execution should not call the general `QueryService.handleQuery()` because that path triggers chat-style intent detection and writes final chat messages. Instead, add a local task executor that uses:

- `ModelModule.getModel()`
- `BaseModel.generateMessages()`
- `BaseModel.fetchStreamWithContextMessage()`
- available MCP tools if local task prompts need tool use

There are two viable local execution levels:

1. **Simple local executor v1**
   - Generate a direct model response from the task prompt and previous task results.
   - No intent trigger.
   - Optional MCP tool support through the same tool loop used by `IntentFulfillService`.

2. **Reusable tool-loop extraction**
   - Extract the model/tool loop from `IntentFulfillService` into a shared `ToolCallingService`.
   - Use it from both chat intent fulfillment and workflow local task execution.

The second option is cleaner and avoids duplicating MCP/A2A tool-call mechanics.

### A2A Tasks

If a task specifies:

```ts
agent: {
  protocol: "A2A",
  connectorName: "sales-agent"
}
```

the workflow task executor should route the task prompt to that A2A connector.

Recommended A2A module additions:

```ts
sendTask(params: {
  connectorName: string;
  message: string;
  threadId: string;
  metadata?: Record<string, unknown>;
}): AsyncGenerator<StreamEvent, string, unknown>
```

This avoids pretending the remote agent is a model-selected tool during workflow execution. The workflow already knows which agent should run the task.

The existing A2A task/context handling can be reused:

- ADK `threadId` maps to A2A `contextId`
- remote `taskId` can still be tracked by thread
- remote `working` status maps to `thinking_process`
- remote completed text becomes the task result content

## Response Composition

After all tasks complete, the workflow response composer builds the final response from `response.blocks`.

### Block Inputs

Each block receives:

- workflow metadata
- all task results
- optionally filtered `sourceTaskIds`

### Heading Block

Heading blocks are deterministic. They do not need model generation.

Example:

```ts
{ type: "heading", level: 2, text: "Daily Sales Summary" }
```

Output:

```md
## Daily Sales Summary
```

### Text Block

Text blocks should use the model to generate prose from task results.

Example:

```ts
{
  type: "text",
  prompt: "Summarize the key findings from {{task.sales.content}}.",
  sourceTaskIds: ["sales"]
}
```

The composer should call the model with a response-composition prompt, not the normal chat intent prompt.

### Table Block

Table blocks should produce structured table data plus a markdown fallback.

Recommended output shape:

```ts
export interface WorkflowRenderedBlock {
  blockId: string;
  type: "heading" | "text" | "table";
  content: string;
  data?: unknown;
}
```

For table:

```ts
data: {
  columns: [{ key: "metric", label: "Metric" }],
  rows: [{ metric: "Revenue" }]
}
```

The final model message can store:

```ts
content: { type: "text", parts: [finalMarkdown] }
metadata: {
  workflowId,
  workflowRun: true,
  taskResults,
  responseBlocks: renderedBlocks,
}
```

This keeps current chat compatibility while allowing future UI to render structured blocks from metadata.

## Streaming Execution

Structured workflow execution must support streaming. The workflow streaming endpoint should use the same SSE event contract as normal chat streaming so the UI can consume chat and workflow streams through the same client code.

Required workflow stream events:

- `thread_id`: emitted after thread creation
- `thinking_process`: emitted for workflow start, each task start, A2A working updates, response composition
- `text_chunk`: emitted while rendering final response
- `collection_name`: emitted if an integration provides collection metadata
- `error`: emitted on failure

Workflow execution should not introduce workflow-specific SSE event names in the first version. If the UI needs task/block detail, encode it inside `thinking_process.data` while preserving the existing event name:

```ts
{
  event: "thinking_process",
  data: {
    title: "[워크플로우] 작업 실행: 매출 요약",
    description: "sales-agent 에이전트에 작업을 위임합니다.",
    metadata: {
      phase: "task",
      taskId: "sales-summary",
      agent: { protocol: "A2A", connectorName: "sales-agent" }
    }
  }
}
```

If stronger typed workflow events are needed later, they should be added as an explicit v2 stream contract rather than mixed into the initial workflow stream.

## Failure Policy

Add a workflow-level failure policy later, but start with simple defaults:

- If a task fails, store a failed `WorkflowTaskResult`.
- Continue executing later tasks only if they do not depend on the failed task.
- If response composition cannot proceed, store a final model message describing the failure.
- Scheduled workflow failures should not crash the scheduler.

Future schema:

```ts
failurePolicy?: "fail_fast" | "continue";
```

## API Changes

Existing workflow APIs can remain:

- `/api/workflow-template`
- `/api/user-workflow`

They should accept and return `definition` when present.

Add explicit manual execution endpoints:

```text
POST /api/user-workflow/:id/execute
```

Request:

```ts
{
  executionVariables?: Record<string, string>
}
```

Response:

```ts
{
  content: string;
  threadId: string
}
```

Required streaming endpoint:

```text
POST /api/user-workflow/:id/execute/stream
```

Request:

```ts
{
  executionVariables?: Record<string, string>
}
```

Response: Server-Sent Events using the same event names as `POST /query/stream`.

The non-streaming endpoint should not have a separate execution implementation. It should run the same workflow stream generator used by `/execute/stream`, consume all events, collect `text_chunk` deltas into `content`, capture `thread_id`, and return the final JSON response. This mirrors the existing chat behavior in `POST /query`.

## Migration Strategy

Support both legacy and structured workflows during migration.

### Legacy Workflow

If `workflow.definition` is missing:

- Keep the current behavior for now.
- Resolve `content`.
- Execute through the old query path.

### Structured Workflow

If `workflow.definition` is present:

- Use the new workflow execution path.
- Do not call `QueryService.handleQuery()` for the actual workflow logic.
- Use shared thread-writing utilities so thread/message behavior remains compatible.

### Template Copy

When creating a user workflow from a template:

- Copy `definition`
- Resolve creation-time variables inside both `content` and `definition`
- Preserve execution-time variables for later

## Implementation Phases

### Phase 1: Types and Storage Compatibility

- Add `WorkflowDefinition`, `WorkflowTask`, `WorkflowResponseBlock`, and `WorkflowTaskResult` types.
- Extend `WorkflowTemplate` and `UserWorkflow` with optional `definition`.
- Update variable resolver to resolve structured definitions.
- Keep `content` as legacy required field for now.

### Phase 2: Thread Writer Extraction

- Extract thread creation and message-writing behavior from `QueryService` into a shared service.
- Ensure both chat and workflow can create `ThreadType.WORKFLOW` threads consistently.
- Keep existing thread API unchanged.

### Phase 3: Workflow Execution Path

- Refactor `WorkflowExecutionService` to branch:
  - no `definition`: legacy execution path
  - has `definition`: structured execution path
- Add `WorkflowTaskExecutor`.
- Add local task execution.
- Add direct A2A task execution by connector name.

### Phase 4: Response Composer

- Add `WorkflowResponseComposer`.
- Implement heading, text, and table block rendering.
- Store final markdown in message content.
- Store structured block data in message metadata.

### Phase 5: API and Scheduler

- Add manual execute endpoint.
- Add streaming execute endpoint with the same SSE event contract as chat.
- Implement non-streaming execution by consuming the same workflow stream used by the streaming endpoint.
- Keep scheduler calling `WorkflowExecutionService.executeWorkflow()`, so scheduled structured workflows work automatically.

### Phase 6: Tests and Hardening

- Unit test variable resolution for structured definitions.
- Unit test local task execution with mocked model.
- Unit test A2A task routing with mocked A2A module.
- Unit test response composer blocks.
- Integration test structured workflow execution creates a workflow thread and final model message.
- Keep legacy workflow execution tests to prevent breaking existing users.

## Suggested File Layout

```text
src/types/workflow.ts
src/services/workflows/workflow-execution.service.ts
src/services/workflows/workflow-task-executor.service.ts
src/services/workflows/local-workflow-task-executor.service.ts
src/services/workflows/a2a-workflow-task-executor.service.ts
src/services/workflows/workflow-response-composer.service.ts
src/services/workflows/workflow-thread-writer.service.ts
```

Existing files can be moved gradually. To reduce churn, the first PR can keep `src/services/workflow-execution.service.ts` and add collaborators next to it.

## Open Questions

- Should table blocks require strictly structured JSON output, or allow model-generated markdown first?
- Should local workflow tasks have MCP tool access by default?
- Should workflow tasks be allowed to call A2A agents only by `connectorName`, or also by agent card skill?
- Should task results be stored as separate hidden messages, only final metadata, or both?
- Should `response.blocks` be generated deterministically from task outputs, or can each block run its own model call?
- How much of `IntentFulfillService` should be extracted into a reusable tool loop?

## Recommended First PR

Start with a conservative first PR:

1. Add workflow types with optional `definition`.
2. Add structured variable resolution.
3. Add a new structured branch in `WorkflowExecutionService`.
4. Implement sequential task execution.
5. Implement direct A2A task execution by connector name.
6. Implement response blocks for `heading` and `text`.
7. Add non-streaming and streaming workflow execute endpoints.
8. Store final response as a normal workflow thread model message with structured metadata.

Then add table blocks and local MCP-enabled task execution in follow-up PRs.
