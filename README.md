# AI Network Agent Development Kit (AIN-ADK)

A TypeScript library for building AI agents with multi-protocol support including MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication.

## Features

- **Multi-Protocol Support**: Integrate with MCP servers and A2A agents
- **Intent-Driven Processing**: Automatic query analysis and tool execution  
- **Dual Build System**: Supports both ESM and CJS formats for maximum compatibility
- **Structured Logging**: Winston-based logging system with multiple loggers
- **TypeScript First**: Built with strict TypeScript configuration

## Installation

```bash
npm install ain-adk
```

## Requirements

- Node.js >= 20
- TypeScript >= 5.8

## Quick Start

### Basic Agent Setup

```typescript
import { AINAgent } from 'ain-adk/ainagent';
import { IntentAnalyzer } from 'ain-adk/intent/analyzer';
import AzureOpenAI from 'ain-adk/models/openai';

// Initialize the model
const model = new AzureOpenAI(...);

// Create intent analyzer and agent
const intentAnalyzer = new IntentAnalyzer(model);
const agent = new AINAgent(intentAnalyzer);

// Start the server
agent.start(3000);
```

### (Optional) Adding MCP tools

```typescript
import { MCPClient } from 'ain-adk/intent/modules/mcp/mcpClient';

const mcpClient = new MCPClient();

// Add MCP server configuration
await mcpClient.addMCPConfig({
  notionApi: {
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      NOTION_API_KEY: process.env.NOTION_API_KEY!
    }
  }
});

// Add to intent analyzer
intentAnalyzer.addMCPModule(mcpClient);
```

### (Optional) Adding A2A 

```typescript
import { A2AModule } from 'ain-adk/intent/modules/a2a/a2a';

// Create A2A module and add servers
const a2aModule = new A2AModule();
await a2aModule.addA2AServer('http://localhost:3100/a2a');
intentAnalyzer.addA2AModule(a2aModule);

// Enable A2A server mode
const agent = new AINAgent(intentAnalyzer, true);
```

## Architecture

### Core Components

- **AINAgent** (`src/ainagent.ts`): Main Express.js server class that orchestrates agent functionality
- **IntentAnalyzer** (`src/intent/analyzer.ts`): Central orchestrator for query processing and tool execution
- **MCPClient** (`src/intent/modules/mcp/mcpClient.ts`): Manages connections to MCP servers
- **A2AModule** (`src/intent/modules/a2a/a2a.ts`): Handles agent-to-agent communication
- **BaseModel** (`src/models/base.ts`): Abstract base class for AI model implementations

### Protocol Modules

#### MCP (Model Context Protocol)
- Connects to external MCP servers
- Provides tool discovery and execution
- Supports stdio-based communication

#### A2A (Agent-to-Agent)  
- Enables multi-agent workflows
- Supports streaming communication
- Handles task management and context

### Key Features

- **Modular Design**: Protocol-agnostic tool system through `AgentTool` interface
- **Type Safety**: Comprehensive TypeScript types throughout
- **Error Handling**: Robust error handling with structured logging
- **Streaming Support**: Built-in support for streaming responses

## Development

### Scripts

```bash
# Build commands
npm run build          # Build both ESM and CJS distributions
npm run build:esm      # Build ESM format only  
npm run build:cjs      # Build CJS format only

# Code quality
npm run lint           # Run linting with Biome
npm run format         # Format code with Biome
npm run check          # Check code with Biome
npm run check:write    # Check and auto-fix with Biome

# Testing
npm run test           # Run Jest tests
```

### Examples

```bash
# Run example applications
npx tsx examples/simpleAgent.ts
npx tsx examples/a2aClientAgent.ts
```

## Logging System

The library uses Winston for structured logging with multiple service-specific loggers:

```typescript
import { loggers } from 'ain-adk/utils/logger';

// Available loggers
loggers.agent.info('AINAgent started');
loggers.intent.debug('Processing query');
loggers.mcp.info('Connected to MCP server');
loggers.a2a.warn('A2A connection timeout');
loggers.model.error('Model API error');
loggers.server.info('A2A server started');
```

### Log Levels
- `error`: Error conditions
- `warn`: Warning conditions  
- `info`: Informational messages (default)
- `debug`: Debug-level messages

## API Endpoints

### Standard Endpoints
- `GET /` - Welcome message
- `POST /query` - Process queries through intent analyzer

### A2A Server Endpoints (when enabled)
- `GET /agent-card` - Get agent card information
- `GET /.well-known/agent.json` - Agent discovery endpoint  
- `POST /a2a` - A2A communication endpoint with streaming support

## Build System

The project supports dual build output:

- **ESM** (`dist/esm/`): ES Module format with `{"type": "module"}`
- **CJS** (`dist/cjs/`): CommonJS format with `{"type": "commonjs"}`

Import paths use `@/` alias for `src/` directory.

## Error Handling

Comprehensive error handling throughout:
- MCP connection failures
- A2A communication errors  
- Model API errors
- Tool execution failures

All errors are logged with appropriate context and error details.

## Contributing

1. Follow the established code conventions
2. Use TypeScript strict mode
3. Add appropriate logging
4. Run linting and tests before submitting

## License

MIT