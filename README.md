# AI Network Agent Development Kit (AIN-ADK)

A TypeScript library for building AI agents with multi-protocol support including MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication.

## NOTE
**IMPORTANT: This project is currently under active development. Features may be incomplete, and there might be significant changes in future updates. Please be aware that some functionalities may not work as expected or might change without prior notice.**

## Features

- **Multi-Protocol Support**: Integrate with MCP servers and A2A agents
- **Modular Architecture**: Flexible module system for models, memory, MCP, and A2A
- **Multiple AI Models**: Support for OpenAI and Gemini with easy extensibility
- **Thread Management**: Built-in memory module for conversation history
- **Intent System**: Single/multi-intent triggering with intelligent response aggregation
- **Workflow Management**: Built-in workflow storage and execution with display query support
- **Dual Build System**: Supports both ESM and CJS formats for maximum compatibility
- **Structured Logging**: Winston-based logging system with service-specific loggers
- **TypeScript First**: Built with strict TypeScript configuration

## Installation

#### **npm**
```bash
npm install @ainetwork/adk
```
#### **yarn**
```bash
yarn add @ainetwork/adk
```

### Requirements

- Node.js >= 20
- TypeScript >= 5.8

## Getting Start

To see how to use this package in your project, check out our comprehensive examples:

👉 **[View Examples](https://github.com/ainetwork-ai/ain-adk-providers/tree/main/examples)**

## Architecture

### Core Components

- **AINAgent** (`src/index.ts`): Main Express.js server class that orchestrates all modules
- **DI Container** (`src/container/`): Dependency injection container for services and controllers
- **ModelModule** (`src/modules/models/`): Manages AI model integrations with streaming support
- **MCPModule** (`src/modules/mcp/`): Handles Model Context Protocol connections
- **A2AModule** (`src/modules/a2a/`): Manages agent-to-agent communication
- **MemoryModule** (`src/modules/memory/`): Provides threads, intents, and conversation history

### Module System

The library uses a flexible module architecture:

```typescript
interface AINAgentModules {
  authModule: AuthModule;      // Required - authentication handling
  modelModule: ModelModule;    // Required - AI model integrations
  memoryModule: MemoryModule;  // Required - thread/intent/workflow storage
  a2aModule?: A2AModule;       // Optional - agent-to-agent communication
  mcpModule?: MCPModule;       // Optional - MCP server connections
}
```

Each module can be independently configured and passed to the agent constructor.

### Intent System

The library supports flexible intent triggering modes:

- **Multi-Intent Mode (Default)**: Decomposes complex queries into multiple subqueries and maps each to an intent
- **Single-Intent Mode**: Identifies a single intent without query decomposition (set `DISABLE_MULTI_INTENTS=true`)
- **Intelligent Aggregation**: LLM-based aggregation determines if multiple intent responses need unification
- **Streaming Support**: Real-time response streaming with `thinking_process` events for progress visibility

### Workflow System

Built-in workflow management capabilities:

- **Workflow Storage**: Save, retrieve, list, and delete workflows via MemoryModule
- **Display Query Support**: Separate display query for workflow execution visualization
- **RESTful API**: Complete workflow management through `/api/workflows` endpoints

### Dependency Injection

The library uses a DI Container pattern for managing services and controllers:

```
src/
├── config/              # Global configuration
│   ├── agent.ts         # Agent instance access
│   ├── modules.ts       # Module registry (ModelModule, MemoryModule, etc.)
│   ├── options.ts       # Options registry (onIntentFallback, etc.)
│   └── manifest.ts      # Agent manifest
├── container/           # DI Container
│   ├── index.ts         # Main container with convenience methods
│   ├── services.ts      # Service factory (QueryService, ThreadService, etc.)
│   └── controllers.ts   # Controller factory (QueryController, etc.)
```

Benefits:
- Centralized dependency management
- Singleton instances for memory efficiency
- Easy testing with mock injection
- Clean separation between configuration and runtime objects

### Protocol Support

#### MCP (Model Context Protocol)
- Connects to external MCP servers via stdio
- Automatic tool discovery and execution
- Supports multiple concurrent MCP servers
- Protocol-specific tool wrapping as `IMCPTool`

#### A2A (Agent-to-Agent)  
- RESTful API for inter-agent communication
- Streaming response support via SSE
- Agent discovery via well-known endpoints (`.well-known/agent-card.json`)
- Task delegation with thread context passing
- Protocol version 0.3.0 support

### Key Features

- **Unified Tool Interface**: Protocol-agnostic `ConnectorTool` and `IAgentConnector` interfaces
- **Streaming Support**: Dual implementation for streaming and non-streaming queries
- **Intent System**: Single/multi-intent triggering with intelligent response aggregation
- **Workflow Management**: Built-in workflow storage and execution with display query support
- **Service Layer**: Clean separation with controllers and services
- **Type Safety**: Comprehensive TypeScript types with strict mode
- **Error Handling**: Global error middleware with structured logging
- **Authentication**: Required auth middleware via `AuthModule` interface
- **Graceful Shutdown**: Proper cleanup of modules and connections

## Development

### Scripts

```bash
# Build commands
yarn build          # Build both ESM and CJS distributions

# Development
yarn dev            # Run TypeScript directly with tsx

# Code quality
yarn biome          # Check code with Biome
yarn biome:write    # Check and auto-fix with Biome

# Testing
yarn test           # Run Jest tests

# Clean
yarn clean          # Remove build artifacts
```

## Logging System

The library uses Winston for structured logging with service-specific loggers:

```typescript
import { getLogger } from '@ainetwork/adk/utils/logger';

// Get service-specific loggers
const agentLogger = getLogger('agent');
const mcpLogger = getLogger('mcp');
const a2aLogger = getLogger('a2a');
const modelLogger = getLogger('model');

// Usage examples
agentLogger.info('AINAgent started');
mcpLogger.debug('Connected to MCP server');
a2aLogger.warn('A2A connection timeout');
modelLogger.error('Model API error');
```

### Available Loggers
- `agent`: Main agent operations (AINAgent)
- `intent`: Non-streaming query processing and intent analysis (Intent)
- `intentStream`: Streaming query processing (IntentStream)
- `mcp`: MCP server connections and tool execution (MCPModule)
- `a2a`: Agent-to-agent communication (A2AModule)
- `model`: AI model interactions (Model)
- `server`: A2A server operations (A2AServer)

### Log Levels
- `error`: Error conditions
- `warn`: Warning conditions  
- `info`: Informational messages (default)
- `debug`: Debug-level messages

## API Endpoints

### Standard Endpoints
- `GET /` - Welcome message and health check
- `POST /query` - Process queries (non-streaming)
  - Request: `{ query: string, threadId?: string, type?: string, displayQuery?: string }`
  - Response: `{ content: string, threadId: string }`
- `POST /query/stream` - Process queries with streaming (SSE)
  - Request: `{ query: string, threadId?: string, type?: string, displayQuery?: string }`
  - Response: Server-Sent Events stream with event types:
    - `text_chunk`: Incremental text response
    - `tool_start`: Tool execution started
    - `tool_output`: Tool execution result
    - `thread_id`: Thread metadata
    - `intent_process`: Intent processing status
    - `thinking_process`: Thinking/reasoning steps
    - `error`: Error message

### Agent Management
- `GET /api/threads` - List user threads (userId from auth)
- `GET /api/threads/:id` - Get thread details
- `POST /api/threads/:id/delete` - Delete thread
- `GET /api/model` - Get model list
- `GET /api/agent/a2a` - Get A2A connectors
- `GET /api/intent` - List all intents
- `POST /api/intent/save` - Save intent
- `POST /api/intent/:id/delete` - Delete intent
- `GET /api/workflows` - List all workflows
- `GET /api/workflows/:id` - Get workflow details
- `POST /api/workflows` - Create new workflow
- `POST /api/workflows/update/:id` - Update workflow
- `POST /api/workflows/delete/:id` - Delete workflow

### A2A Server Endpoints (when `manifest.url` is configured)
- `GET /.well-known/agent.json` - Agent discovery endpoint (A2A ~v0.2.0)
- `GET /.well-known/agent-card.json` - Agent discovery endpoint (A2A v0.3.0~)
  - Returns `AgentCard` with capabilities and supported modes
- `POST /a2a` - A2A communication endpoint
  - Supports streaming responses via SSE
  - Request: `{ message: string, threadId?: string, stream?: boolean }`
  - Response: JSON or SSE stream based on `stream` parameter

## Build System

The project supports dual build output:

- **ESM** (`dist/esm/`): ES Module format with `{"type": "module"}`
- **CJS** (`dist/cjs/`): CommonJS format with `{"type": "commonjs"}`

## Error Handling

The library includes comprehensive error handling:
- Global error middleware for uncaught errors
- Custom `AinHttpError` class for HTTP-specific errors
- Service-specific error logging with structured context
- Graceful handling of:
  - MCP server connection failures
  - A2A agent communication errors  
  - Model API failures (rate limits, timeouts)
  - Tool execution errors
  - Invalid requests
  - Streaming errors with proper cleanup

All errors are logged with appropriate context for debugging.

## Authentication

The library requires an authentication module:

```typescript
import { AuthModule } from '@ainetwork/adk/modules';
import type { AuthResponse } from '@ainetwork/adk/types/auth';

class MyAuth extends AuthModule {
  async authenticate(req: Request, res: Response): Promise<AuthResponse> {
    // Implement your auth logic
    return { isAuthenticated: true, userId: 'user-123' };
  }
}

const agent = new AINAgent(manifest, {
  authModule: new MyAuth(),
  modelModule,
  memoryModule,
});
```

## Contributing

1. Follow the established code conventions (tabs, double quotes)
2. Use TypeScript strict mode
3. Add appropriate service-specific logging
4. Run `yarn biome:write` and `yarn test` before submitting
5. Maintain the modular architecture
6. Update JSDoc comments when changing function signatures
7. Add streaming support when implementing new query handlers

## License

MIT
