# AI Network Agent Development Kit (AIN-ADK)

A TypeScript library for building AI agents with multi-protocol support including MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication.

## NOTE
**IMPORTANT: This project is currently under active development. Features may be incomplete, and there might be significant changes in future updates. Please be aware that some functionalities may not work as expected or might change without prior notice.**

## Features

- **Multi-Protocol Support**: Integrate with MCP servers and A2A agents
- **Modular Architecture**: Flexible module system for models, memory, MCP, and A2A
- **Multiple AI Models**: Support for OpenAI and Gemini with easy extensibility
- **Thread Management**: Built-in memory module for conversation history
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
- **ModelModule** (`src/modules/models/`): Manages AI model integrations with streaming support
- **MCPModule** (`src/modules/mcp/`): Handles Model Context Protocol connections
- **A2AModule** (`src/modules/a2a/`): Manages agent-to-agent communication
- **MemoryModule** (`src/modules/memory/`): Provides threads, intents, and conversation history

### Module System

The library uses a flexible module architecture:

```typescript
interface AINAgentModules {
  modelModule?: ModelModule;
  mcpModule?: MCPModule;
  a2aModule?: A2AModule;
  memoryModule?: MemoryModule;
}
```

Each module can be independently configured and passed to the agent constructor.

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

- **Unified Tool Interface**: Protocol-agnostic `IAgentTool` interface
- **Streaming Support**: Dual implementation for streaming and non-streaming queries
- **Intent System**: Intent detection and fulfillment with custom prompts
- **Service Layer**: Clean separation with controllers and services
- **Type Safety**: Comprehensive TypeScript types with strict mode
- **Error Handling**: Global error middleware with structured logging
- **Authentication**: Optional auth middleware via `BaseAuth` interface
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
- `agent`: Main agent operations
- `intent`: Non-streaming query processing and intent analysis
- `intentStream`: Streaming query processing
- `mcp`: MCP server connections and tool execution
- `a2a`: Agent-to-agent communication
- `model`: AI model interactions
- `server`: HTTP server operations
- `memory`: Threads, intents, and agent data management

### Log Levels
- `error`: Error conditions
- `warn`: Warning conditions  
- `info`: Informational messages (default)
- `debug`: Debug-level messages

## API Endpoints

### Standard Endpoints
- `GET /` - Welcome message and health check
- `POST /query` - Process queries (non-streaming)
  - Request: `{ message: string, threadId?: string, type?: string }`
  - Response: `{ content: string }`
- `POST /query/stream` - Process queries with streaming (SSE)
  - Request: `{ message: string, threadId?: string, type?: string }`
  - Response: Server-Sent Events stream with event types:
    - `text_chunk`: Incremental text response
    - `tool_start`: Tool execution started
    - `tool_output`: Tool execution result
    - `thread_id`: Thread metadata
    - `error`: Error message

### Agent Management
- `GET /api/threads/:userId` - List user threads
- `POST /api/threads/:userId` - Create new thread
- `GET /api/threads/:userId/:threadId` - Get thread details
- `DELETE /api/threads/:userId/:threadId` - Delete thread
- `GET /api/model` - Get model configuration
- `POST /api/model` - Set default model

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

The library supports optional authentication middleware:

```typescript
import { BaseAuth } from '@ainetwork/adk/modules';

class MyAuth extends BaseAuth {
  async authenticate(req: Request, res: Response): Promise<boolean> {
    // Implement your auth logic
    return true;
  }
}

const agent = new AINAgent(manifest, modules, new MyAuth());
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
