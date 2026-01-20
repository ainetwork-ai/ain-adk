# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the AI Network Agent Development Kit (AIN-ADK), a TypeScript library for building AI agents with multi-protocol support. The library enables seamless integration with both MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication protocols.

## Key Commands

### Development
```bash
# Install dependencies
yarn install

# Build the project (dual ESM/CJS output)
yarn build
yarn build:esm  # ESM only
yarn build:cjs  # CJS only

# Run tests
yarn test

# Code quality
yarn biome        # Check code
yarn biome:write  # Check and auto-fix

# Development mode
yarn dev        # Run TypeScript directly with tsx
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
   - **MemoryModule** (`src/modules/memory/`): Data persistence (required)
     - Thread management for conversation history
     - Intent storage and retrieval
     - Workflow storage and retrieval
     - Agent metadata management
   - **MCPModule** (`src/modules/mcp/`): Model Context Protocol client connections (optional)
     - Tool discovery and execution from MCP servers
     - Protocol implementation via stdio
   - **A2AModule** (`src/modules/a2a/`): Agent-to-Agent communication (optional)
     - RESTful API for inter-agent communication
     - Agent discovery via well-known endpoints
     - Task delegation with context passing

3. **Configuration Layer** (`src/config/`)
   - `agent.ts`: Global agent instance access
   - `modules.ts`: Module registry (setModules/getModelModule/getMemoryModule/etc.)
   - `options.ts`: Options registry (setOptions/getOnIntentFallback)
   - `manifest.ts`: Agent manifest storage

4. **DI Container** (`src/container/`)
   - `index.ts`: Main Container class with convenience methods
   - `services.ts`: ServiceContainer for service singletons
     - ThreadService, IntentTriggerService, IntentFulfillService, AggregateService
     - SingleIntentTriggerService, MultiIntentTriggerService
     - QueryService, A2AService
   - `controllers.ts`: ControllerContainer for controller singletons
     - QueryController, IntentController
     - ModelApiController, AgentApiController, ThreadApiController, IntentApiController, WorkflowApiController

5. **Service Layer** (`src/services/`)
   - `query.service.ts`: Query processing with intent detection and fulfillment
   - `thread.service.ts`: Thread management operations
   - `a2a.service.ts`: A2A protocol operations
   - `intents/trigger.service.ts`: Intent triggering router (single/multi mode)
   - `intents/single-trigger.service.ts`: Single intent triggering without query decomposition
   - `intents/multi-trigger.service.ts`: Multi-intent triggering with query decomposition
   - `intents/fulfill.service.ts`: Intent fulfillment with tool execution
   - `intents/aggregate.service.ts`: Intelligent response aggregation for multi-intent results

6. **Controller Layer** (`src/controllers/`)
   - `query.controller.ts`: Query endpoint handlers (both streaming and non-streaming)
   - `a2a.controller.ts`: A2A-specific endpoint handlers
   - `api/threads.api.controller.ts`: Thread management API
   - `api/model.api.controller.ts`: Model management API
   - `api/agent.api.controller.ts`: Agent management API
   - `api/intent.api.controller.ts`: Intent management API
   - `api/workflow.api.controller.ts`: Workflow management API

7. **Tool Abstraction**
   - `ConnectorTool` type for protocol-agnostic tool representation
   - `IAgentConnector` interface for connector management (MCP/A2A)
   - `CONNECTOR_PROTOCOL_TYPE` enum for tool source identification

8. **Type System** (`src/types/`)
   - `agent.ts`: Agent manifest and configuration types
   - `memory.ts`: Thread, Intent, Workflow, and message types (includes FulfillmentResult)
   - `stream.ts`: Streaming event and chunk types
   - `tool.ts`: Tool interfaces and response types
   - `auth.ts`: Authentication scheme interfaces
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
   - Available loggers: `agent`, `intent`, `intentStream`, `mcp`, `a2a`, `model`, `server`, `fol`
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
   - Standard query endpoints: `/query`
   - API for agent management: `/api`
   - A2A endpoints: `/a2a` (only available in A2A server mode)

5. **Testing**
   - Use Jest for unit tests
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

The library supports two intent triggering modes:

1. **Multi-Intent Mode (Default)**
   - Decomposes queries into multiple subqueries
   - Maps each subquery to an intent
   - Collects all intent responses
   - Uses `AggregateService` to determine if responses need unification
   - LLM-based aggregation creates a cohesive final response if needed
   - Services: `MultiIntentTriggerService`, `AggregateService`

2. **Single-Intent Mode** (`DISABLE_MULTI_INTENTS=true`)
   - No query decomposition
   - Identifies single most relevant intent
   - Streams response directly without aggregation
   - Simplified prompts for faster processing
   - Service: `SingleIntentTriggerService`

The `IntentTriggerService` acts as a router, delegating to the appropriate service based on the environment variable.

### Workflow System

The library provides built-in workflow management:

- **Workflow Memory Interface**: Abstract methods in `BaseMemoryModule`
  - `createWorkflow(workflow)`: Create new workflow
  - `updateWorkflow(id, workflow)`: Update existing workflow
  - `getWorkflow(id)`: Retrieve workflow by ID
  - `listWorkflows(userId?)`: List workflows (optionally filtered by userId)
  - `deleteWorkflow(id)`: Delete workflow
- **Workflow API**: RESTful endpoints via `WorkflowApiController`
  - `GET /api/workflows`: List workflows
  - `GET /api/workflows/:id`: Get workflow details
  - `POST /api/workflows`: Create new workflow
  - `POST /api/workflows/update/:id`: Update workflow
  - `POST /api/workflows/delete/:id`: Delete workflow
- **Display Query Support**: Queries can include optional `displayQuery` parameter for workflow visualization

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