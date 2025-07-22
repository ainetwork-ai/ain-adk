# AI Network Agent Development Kit (AIN-ADK)

A TypeScript library for building AI agents with multi-protocol support including MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication.

# NOTE
IMPORTANT: This project is currently under active development. Features may be incomplete, and there might be significant changes in future updates. Please be aware that some functionalities may not work as expected or might change without prior notice.

# Features

- **Multi-Protocol Support**: Integrate with MCP servers and A2A agents
- **Modular Architecture**: Flexible module system for models, memory, MCP, and A2A
- **Multiple AI Models**: Support for OpenAI and Gemini with easy extensibility
- **Session Management**: Built-in memory module for conversation history
- **Dual Build System**: Supports both ESM and CJS formats for maximum compatibility
- **Structured Logging**: Winston-based logging system with service-specific loggers
- **TypeScript First**: Built with strict TypeScript configuration

## Installation

```bash
npm install @ainetwork/adk
```

## Requirements

- Node.js >= 20
- TypeScript >= 5.8

## Quick Start

### Basic Agent Setup

```typescript
import { AINAgent } from '@ainetwork/adk/app';
import { ModelModule, MCPModule, MemoryModule } from '@ainetwork/adk/modules';
import { AzureOpenAI } from '@ainetwork/adk/modules/models/openai';
import { InMemoryMemory } from '@ainetwork/adk/modules/memory/inmemory';
import { AinAgentManifest } from '@ainetwork/adk/types';

// Initialize modules
const modelModule = new ModelModule();
const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_BASE_URL!,
  process.env.AZURE_OPENAI_API_KEY!,
  process.env.AZURE_OPENAI_API_VERSION!,
  process.env.AZURE_OPENAI_MODEL_NAME!
);
modelModule.addModel('azure-gpt-4o', model);

const memoryModule = new MemoryModule(new InMemoryMemory(""));

// Define agent manifest
const manifest: AinAgentManifest = {
  name: "My Agent",
  description: "An intelligent AI agent",
  version: "0.0.1",
};

// Create and start agent
const agent = new AINAgent(manifest, { modelModule, memoryModule });
agent.start(3000);
```

### Adding MCP Support

```typescript
import { MCPModule } from '@ainetwork/adk/modules';

const mcpModule = new MCPModule();

// Add MCP server configuration
await mcpModule.addMCPConfig({
  notionApi: {
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      NOTION_API_KEY: process.env.NOTION_API_KEY!
    }
  }
});

// Pass to agent constructor
const agent = new AINAgent(manifest, { modelModule, mcpModule, memoryModule });
```

### Adding A2A Support

```typescript
import { A2AModule } from '@ainetwork/adk/modules';

// Define agent manifest
const manifest: AinAgentManifest = {
  ...,
  url: "<AGENT_ENDPOINT_URL>"   // configure manifest.url
};

const agent = new AINAgent(
  manifest,
  { modelModule, a2aModule, memoryModule },
);
```

## Architecture

### Core Components

- **AINAgent** (`src/app.ts`): Main Express.js server class that orchestrates all modules
- **ModelModule** (`src/modules/models/`): Manages AI model integrations (OpenAI, Gemini)
- **MCPModule** (`src/modules/mcp/`): Handles Model Context Protocol connections
- **A2AModule** (`src/modules/a2a/`): Manages agent-to-agent communication
- **MemoryModule** (`src/modules/memory/`): Provides session and conversation history

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

#### A2A (Agent-to-Agent)  
- RESTful API for inter-agent communication
- Streaming response support
- Agent discovery via well-known endpoints
- Task delegation and context passing

### Key Features

- **Unified Tool Interface**: Protocol-agnostic `IAgentTool` interface
- **Service Layer**: Clean separation with controllers and services
- **Type Safety**: Comprehensive TypeScript types throughout
- **Error Handling**: Global error middleware with structured logging
- **Authentication**: Optional auth middleware support

## Development

### Scripts

```bash
# Build commands
yarn build          # Build both ESM and CJS distributions
yarn build:esm      # Build ESM format only  
yarn build:cjs      # Build CJS format only

# Development
yarn dev            # Run TypeScript directly with tsx

# Code quality
yarn lint           # Run linting with Biome
yarn format         # Format code with Biome
yarn check          # Check code with Biome
yarn check:write    # Check and auto-fix with Biome

# Testing
yarn test           # Run Jest tests
```

### Examples

```bash
# Run example applications
npx tsx examples/simpleAgent.ts
npx tsx examples/a2aClientAgent.ts
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
- `intent`: Query processing and intent analysis
- `mcp`: MCP server connections and tool execution
- `a2a`: Agent-to-agent communication
- `model`: AI model interactions
- `server`: HTTP server operations
- `memory`: Session and memory management

### Log Levels
- `error`: Error conditions
- `warn`: Warning conditions  
- `info`: Informational messages (default)
- `debug`: Debug-level messages

## API Endpoints

### Standard Endpoints
- `GET /` - Welcome message
- `POST /query` - Process queries
  - Request: `{ message: string, sessionId?: string }`
  - Response: `{ content: string }`

### A2A Server Endpoints (when `manifest.url` is configured)
- `GET /agent-card` - Get agent card information
- `GET /.well-known/agent.json` - Agent discovery endpoint  
- `POST /a2a` - A2A communication endpoint
  - Supports streaming responses
  - Request: `{ message: string, stream?: boolean }`

## Build System

The project supports dual build output:

- **ESM** (`dist/esm/`): ES Module format with `{"type": "module"}`
- **CJS** (`dist/cjs/`): CommonJS format with `{"type": "commonjs"}`

Import paths use `@/` alias for `src/` directory.

## Models Support

### Built-in Models
- **OpenAI/Azure OpenAI**: Full support for GPT models
- **Google Gemini**: Support for Gemini models

### Custom Models
Extend the `BaseModel` class to add support for other AI models:

```typescript
import { BaseModel } from '@ainetwork/adk/modules/models/base';

class MyCustomModel extends BaseModel {
  async generateResponse(messages: any[], tools?: any[]): Promise<any> {
    // Implement your model logic
  }
}
```

## Error Handling

The library includes comprehensive error handling:
- Global error middleware for uncaught errors
- Service-specific error logging
- Graceful handling of:
  - MCP server connection failures
  - A2A agent communication errors  
  - Model API failures
  - Tool execution errors
  - Invalid requests

All errors are logged with appropriate context for debugging.

## Authentication

The library supports optional authentication middleware:

```typescript
import { BaseAuth } from '@ainetwork/adk/middlewares/auth/base';

class MyAuth extends BaseAuth {
  async authenticate(req: Request): Promise<boolean> {
    // Implement your auth logic
    return true;
  }
}

const agent = new AINAgent(manifest, modules, false, new MyAuth());
```

## Contributing

1. Follow the established code conventions
2. Use TypeScript strict mode
3. Add appropriate service-specific logging
4. Run `yarn check:write` and `yarn test` before submitting
5. Maintain the modular architecture

## License

MIT
