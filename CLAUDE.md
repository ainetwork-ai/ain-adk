# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the AI Network Agent Development Kit (AIN-ADK), a TypeScript library for building AI agents with multi-protocol support. The library enables seamless integration with both MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication protocols.

## Key Commands

### Development
```bash
# Install dependencies
pnpm install

# Build the project (dual ESM/CJS output)
pnpm build
pnpm build:esm  # ESM only
pnpm build:cjs  # CJS only

# Run tests
pnpm test

# Code quality
pnpm biome        # Check code
pnpm biome:write  # Check and auto-fix

# Development mode
pnpm dev        # Run TypeScript directly with tsx
```

## Architecture Overview

### Core Components

1. **AINAgent** (`src/index.ts`)
   - Main Express server class that orchestrates all modules
   - Manages authentication middleware
   - Provides HTTP endpoints for agent interaction
   - Implements A2A discovery endpoints when in server mode
   - Supports streaming responses via SSE (Server-Sent Events)
   - Graceful shutdown handling for all connected modules

2. **Module System**
   - **AuthModule** (`src/modules/auth/`): Authentication handling (required)
     - Abstract class for custom authentication implementations
     - Returns `AuthResponse` with `isAuthenticated` and `userId`
   - **ModelModule** (`src/modules/models/`): AI model integrations (required)
     - Abstract `BaseModel` class for provider-agnostic implementation
     - Support for streaming and non-streaming responses
     - Unified tool/function conversion interface
     - Optional canonical multipart `input` bridge alongside legacy `query: string`
   - **MemoryModule** (`src/modules/memory/`): Data persistence (required)
     - Thread management for conversation history
     - Intent storage and retrieval
     - Workflow template and user workflow storage
     - Agent metadata management
     - Optional `IDocumentMemory` (enables document storage and `/api/document`)
     - Optional `IScheduleRunMemory` (enables `/api/schedule-runs`)
   - **ArtifactModule** (`src/modules/artifacts/`): Binary artifact storage (optional)
     - `IArtifactStore` abstraction for pluggable storage backends
     - `LocalArtifactStore`: filesystem implementation (binary + JSON metadata sidecar)
     - Enables `/api/artifacts` upload/metadata/download/delete routes when configured
   - **MCPModule** (`src/modules/mcp/`): Model Context Protocol client connections (optional)
     - Tool discovery and execution from MCP servers
     - Protocol implementation via stdio
   - **A2AModule** (`src/modules/a2a/`): Agent-to-Agent communication (optional)
     - RESTful API for inter-agent communication
     - Agent discovery via well-known endpoints
     - Task delegation with context passing
     - Multipart/artifact-reference exchange (no raw binary forwarding)

3. **Configuration Layer** (`src/config/`)
   - `agent.ts`: Global agent instance access
   - `modules.ts`: Module registry (setModules/getModelModule/getMemoryModule/etc.)
   - `options.ts`: Options registry (setOptions/getOnIntentFallback)
   - `manifest.ts`: Agent manifest storage

4. **DI Container** (`src/container/`)
   - `index.ts`: single Container class exposing lazy singleton getters for all
     services and controllers (e.g. `getQueryService()`, `getArtifactApiController()`)
   - `container.reset()` clears singletons between tests

5. **Service Layer** (`src/services/`)
   - `query.service.ts`: Query processing with intent detection and fulfillment
   - `thread.service.ts`: Thread management operations
   - `a2a.service.ts`: A2A protocol operations
   - `artifact.service.ts`: Artifact metadata/upload/download/delete with ownership checks
   - `pii.service.ts`: PII filtering (mask/reject modes)
   - `tool-calling.service.ts`: Unified tool execution across MCP/A2A connectors
   - `document-advice.service.ts`: Document advice generation
   - `intents/trigger.service.ts`: Intent triggering (single/multi strategy chosen by `DISABLE_MULTI_INTENTS`)
   - `intents/fulfill.service.ts`: Intent fulfillment with tool execution
   - `intents/aggregate.service.ts`: Intelligent response aggregation for multi-intent results
   - `user-workflow.service.ts`, `user-workflow-coordinator.service.ts`: User workflow CRUD and coordination
   - `workflow-execution.service.ts` (+ `workflow-graph/`, `workflow-table/`, `workflow-response-composer`, `workflow-variable-*`): workflow definition execution and response block rendering
   - `scheduler.service.ts`, `job-runner.service.ts`: Cron-scheduled workflow runs

6. **Controller Layer** (`src/controllers/`)
   - `query.controller.ts`: Query endpoint handlers (both streaming and non-streaming)
   - `a2a.controller.ts`: A2A-specific endpoint handlers
   - `api/threads.api.controller.ts`: Thread management API
   - `api/model.api.controller.ts`: Model management API
   - `api/agent.api.controller.ts`: Agent management API
   - `api/intent.api.controller.ts`: Intent management API
   - `api/artifact.api.controller.ts`: Artifact upload/metadata/download/delete API
   - `api/document.api.controller.ts`: Document management API
   - `api/workflow-template.api.controller.ts`: Workflow template API
   - `api/user-workflow.api.controller.ts`: User workflow API

7. **Tool Abstraction**
   - `ConnectorTool` type for protocol-agnostic tool representation
   - `IAgentConnector` interface for connector management (MCP/A2A)
   - `CONNECTOR_PROTOCOL_TYPE` enum for tool source identification

8. **Type System** (`src/types/`)
   - `agent.ts`: Agent manifest and configuration types
   - `memory.ts`: Thread, Intent, Workflow, and message types; canonical multipart
     `MessageContentPart` union (`text`/`artifact`/`data`/`tool-call`/`tool-result`/`thought`/`document`)
     with `schemaVersion: 2` messages and legacy read compatibility
   - `message-input.ts`: Structured query input (`input.parts`), execution input boundaries
   - `artifact.ts`: `ArtifactObject`, `ArtifactRef`, store input/output types
   - `document.ts`: Document storage types
   - `stream.ts`: Streaming event and chunk types
   - `connector.ts`: Tool/connector interfaces and response types
   - `auth.ts` / `authz.ts`: Authentication and authorization types
   - `schedule.ts`: Schedule run types
   - `mcp.ts`: MCP-specific types

### Key Patterns

1. **DI Container Pattern**: Centralized dependency management via `src/container/`
   - Services and controllers are created as singletons
   - Routes use `container.getXxxController()` for clean, simple code
   - `container.reset()` available for testing
2. **Module Registration**: All modules follow a consistent registration pattern with the main agent
3. **Tool Execution**: Tools are executed through a unified interface regardless of source (MCP/A2A)
4. **Streaming Support**: Dual implementation pattern for query processing (streaming and non-streaming)
5. **Logging**: Service-specific loggers with structured logging
   - Available loggers: `agent`, `intent`, `intentStream`, `mcp`, `a2a`, `model`, `server`, `fol`, `http`
6. **Error Handling**:
   - Global error middleware for uncaught errors
   - Custom `AinHttpError` for HTTP-specific errors
   - Graceful error propagation in streaming contexts
7. **Type Safety**:
   - Extensive use of TypeScript interfaces and strict mode
   - Generic types for model implementations
   - Discriminated unions for stream events

### Important Conventions

1. **Code Style**
   - Use Biome for formatting (tabs, double quotes)
   - Follow existing patterns in similar files
   - Maintain strict TypeScript types

2. **Dependency Injection**
   - Use `src/container/` for obtaining service/controller instances
   - Services receive dependencies via constructor (testable)
   - Global modules accessed via `src/config/modules.ts` getters

3. **Module Development**
   - Extend base module classes when creating new modules
   - Implement proper initialization and cleanup methods
   - Register modules via `setModules()` in AINAgent initialization

4. **API Endpoints**
   - Standard query endpoints: `/query`, `/query/stream` (accept legacy `message: string` or structured `input.parts`)
   - API for agent management: `/api` (`/api/model`, `/api/agent`, `/api/threads`, `/api/intent`, `/api/workflow-template`, `/api/user-workflow`)
   - Conditional APIs: `/api/artifacts` (requires ArtifactModule), `/api/document` (requires IDocumentMemory), `/api/schedule-runs` (requires IScheduleRunMemory)
   - A2A endpoints: `/a2a` (only available in A2A server mode)

5. **Testing**
   - Use Jest for unit tests
   - Tests live in the top-level `tests/` directory (not `src/`) so they are excluded from build output
   - Test files should use `.test.ts` extension
   - Mock external dependencies appropriately
   - Use `container.reset()` to clear singleton instances between tests

### Environment Configuration

The project uses environment variables for configuration. Key variables include:
- Model API keys (OpenAI, Google, Anthropic, etc.)
- Server configuration (port, host)
- A2A settings (agent URL, discovery endpoints)
- Database connections (for memory modules)
- Authentication credentials
- **Intent System Configuration**:
  - `DISABLE_MULTI_INTENTS=true` or `=1`: Enable single-intent mode (default: multi-intent mode)

### Intent System Architecture

The library supports two intent triggering modes, both implemented inside the
single `IntentTriggerService` (`src/services/intents/trigger.service.ts`),
which selects a strategy based on `DISABLE_MULTI_INTENTS`:

1. **Multi-Intent Mode (Default)**
   - Decomposes queries into multiple subqueries
   - Maps each subquery to an intent
   - Collects all intent responses
   - Uses `AggregateService` to determine if responses need unification
   - LLM-based aggregation creates a cohesive final response if needed

2. **Single-Intent Mode** (`DISABLE_MULTI_INTENTS=true`)
   - No query decomposition
   - Identifies single most relevant intent
   - Streams response directly without aggregation
   - Simplified prompts for faster processing

### Workflow System

Workflows are split into immutable templates and user-owned instances:

- **WorkflowTemplate**: admin/system-defined blueprint with a structured
  `definition` (tasks → response blocks: heading/text/graph/table) and a
  variable schema
- **UserWorkflow**: user-owned copy of a template with resolved variable
  values, optional cron `schedule` + `timezone` for scheduled execution
- **Execution**: `WorkflowExecutionService` runs tasks (optionally delegated
  to A2A agents), then composes response blocks; `SchedulerService` +
  `JobRunnerService` handle cron-based runs recorded via `IScheduleRunMemory`
- **APIs**: `/api/workflow-template`, `/api/user-workflow`, `/api/schedule-runs`
- **Display Query Support**: Queries can include optional `displayQuery` parameter for workflow visualization
- Workflow content is text-first for now; execution boundaries use typed
  `WorkflowExecutionInput` reserved for future structured input

### Multi-Modal / Artifact Layer

See `MULTIMODAL_ARTIFACT_PLAN.md` for the full migration plan and progress.

- Messages are canonical multipart (`schemaVersion: 2`, `parts[]`); legacy
  `content`-based records are normalized at read boundaries
- `/query` accepts structured `input.parts` (text + artifact references) and
  returns a canonical `message` plus compatibility `content`
- Streaming emits canonical events (`message_start`, `part_delta`,
  `message_complete`, `artifact_ready`, `tool_start`, `tool_output`) alongside
  the compatibility `text_chunk`
- Artifact binaries live in the optional `ArtifactModule` store, separate from
  thread memory; messages store only artifact references

### Build Considerations

- **Dual Module System**: Outputs both ESM and CJS formats
  - ESM: `dist/esm/` with native ES modules
  - CJS: `dist/cjs/` with CommonJS modules
- **TypeScript Configuration**:
  - Path alias `@/` maps to `src/`
  - Strict mode enabled for type safety
  - Target: ES2022 or later
- **Build Tool**: Uses tsup for efficient bundling
- **Export Paths**: 
  - Main entry: `@ainetwork/adk`
  - Modules: `@ainetwork/adk/modules`
  - Types: `@ainetwork/adk/types/*`
  - Utils: `@ainetwork/adk/utils/*`