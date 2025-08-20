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
   - **ModelModule** (`src/modules/models/`): AI model integrations
     - Abstract `BaseModel` class for provider-agnostic implementation
     - Support for streaming and non-streaming responses
     - Unified tool/function conversion interface
   - **MCPModule** (`src/modules/mcp/`): Model Context Protocol client connections
     - Tool discovery and execution from MCP servers
     - Protocol implementation via stdio
   - **A2AModule** (`src/modules/a2a/`): Agent-to-Agent communication
     - RESTful API for inter-agent communication
     - Agent discovery via well-known endpoints
     - Task delegation with context passing
   - **MemoryModule** (`src/modules/memory/`): Data persistence
     - Thread management for conversation history
     - Intent storage and retrieval
     - Agent metadata management

3. **Service Layer** (`src/services/`)
   - `query.service.ts`: Non-streaming query processing
     - Intent detection and fulfillment
     - Tool orchestration across protocols
     - Thread history management
   - `query-stream.service.ts`: Streaming query processing
     - Real-time response streaming
     - Progressive tool execution updates
     - Event-based communication via StreamEvent types
   - `a2a.service.ts`: A2A protocol operations

4. **Controller Layer** (`src/controllers/`)
   - `query.controller.ts`: Query endpoint handlers (both streaming and non-streaming)
   - `a2a.controller.ts`: A2A-specific endpoint handlers
   - `api/threads.api.controller.ts`: Thread management API
   - `api/model.api.controller.ts`: Model configuration API

5. **Tool Abstraction**
   - Unified `IAgentTool` interface for protocol-agnostic tool execution
   - Protocol-specific tool types: `IMCPTool`, `IA2ATool`
   - `TOOL_PROTOCOL_TYPE` enum for tool source identification

6. **Type System** (`src/types/`)
   - `agent.ts`: Agent manifest and configuration types
   - `memory.ts`: Thread, Intent, and message types
   - `stream.ts`: Streaming event and chunk types
   - `tool.ts`: Tool interfaces and response types
   - `auth.ts`: Authentication scheme interfaces
   - `mcp.ts`: MCP-specific types

### Key Patterns

1. **Module Registration**: All modules follow a consistent registration pattern with the main agent
2. **Tool Execution**: Tools are executed through a unified interface regardless of source (MCP/A2A)
3. **Streaming Support**: Dual implementation pattern for query processing (streaming and non-streaming)
4. **Logging**: Service-specific loggers with structured logging
   - Available loggers: `agent`, `intent`, `intentStream`, `mcp`, `a2a`, `model`, `server`, `memory`
5. **Error Handling**: 
   - Global error middleware for uncaught errors
   - Custom `AinHttpError` for HTTP-specific errors
   - Graceful error propagation in streaming contexts
6. **Type Safety**: 
   - Extensive use of TypeScript interfaces and strict mode
   - Generic types for model implementations
   - Discriminated unions for stream events

### Important Conventions

1. **Code Style**
   - Use Biome for formatting (tabs, double quotes)
   - Follow existing patterns in similar files
   - Maintain strict TypeScript types

2. **Module Development**
   - Extend base module classes when creating new modules
   - Implement proper initialization and cleanup methods
   - Use dependency injection pattern

3. **API Endpoints**
   - Standard query endpoints: `/query`
   - API for agent management: `/api`
   - A2A endpoints: `/a2a` (only available in A2A server mode)

4. **Testing**
   - Use Jest for unit tests
   - Test files should use `.test.ts` extension
   - Mock external dependencies appropriately

### Environment Configuration

The project uses environment variables for configuration. Key variables include:
- Model API keys (OpenAI, Google, Anthropic, etc.)
- Server configuration (port, host)
- A2A settings (agent URL, discovery endpoints)
- Database connections (for memory modules)
- Authentication credentials

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