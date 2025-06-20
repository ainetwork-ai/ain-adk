# AI Network Agent Development Kit

A TypeScript library for building AI agents with multi-protocol support including MCP (Model Context Protocol) and A2A (Agent-to-Agent) communication.

## Features

- **Multi-Protocol Support**: Integrate with MCP servers and A2A agents
- **Intent-Driven Processing**: Automatic query analysis and tool selection
- **Dual Build System**: Supports both ESM and CJS formats

## Installation

```bash
npm install ain-adk
```

## Quick Start

### Basic Agent Setup

#### Example: Using Azure OpenAI
```typescript
import { AINAgent } from 'ain-adk/ainagent';
import { IntentAnalyzer } from 'ain-adk/intent/analyzer';
import AzureOpenAI from 'ain-adk/models/openai';

const model = new AzureOpenAI(
  process.env.AZURE_OPENAI_PTU_BASE_URL!,
  process.env.AZURE_OPENAI_PTU_API_KEY!,
  process.env.AZURE_OPENAI_PTU_API_VERSION!,
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
  process.env.AZURE_OPENAI_BASE_PROMPT!,
);

const intentAnalyzer = new IntentAnalyzer(model);
const agent = new AINAgent(intentAnalyzer);

agent.start(process.env.PORT);
```

### Adding MCP Integration

#### Example: Notion MCP
```typescript
import { MCPClient } from 'ain-adk/intent/modules/mcp/mcpClient';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio';

...

const mcp = new MCPClient(model);

await mcp.addMCPConfig({
  notionApi: {
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: {
      ...getDefaultEnvironment(),
      "OPENAPI_MCP_HEADERS": `{"Authorization": "Bearer ${process.env.NOTION_API_KEY}"}`
    }
  }
});

intentAnalyzer.addMCPModule(mcp);

...
```

### Adding A2A Communication

```typescript
import { A2AModule } from 'ain-adk/intent/modules/a2a/a2a';

...

const a2aModule = new A2AModule(model);
await a2aModule.addA2AServer("http://localhost:3100");
intentAnalyzer.addA2AModule(a2aModule);

// Enable A2A server endpoints
const agent = new AINAgent(intentAnalyzer, true);

...
```

## Architecture

### Core Components

- **AINAgent**: Main Express.js server orchestrating agent functionality
- **IntentAnalyzer**: Processes queries through intent analysis and tool execution
- **MCPClient**: Connects to MCP servers for external tool access
- **A2AModule**: Enables agent-to-agent communication
- **Models**: Abstraction layer for AI models

### Protocol Modules

- **MCP (Model Context Protocol)**: Access external tools and data sources
- **A2A (Agent-to-Agent)**: Multi-agent workflows and communication

## Environment Variables

For logging:
```bash
LOG_LEVEL=info  # Options: error, warn, info, debug
```

## Development

### Build

```bash
npm run build          # Build both ESM and CJS
npm run build:esm      # Build ESM only
npm run build:cjs      # Build CJS only
```

### Testing & Linting

```bash
npm test               # Run tests
npm run lint           # Run ESLint
```

### Examples

```bash
# Simple agent with MCP integration
npx tsx examples/simpleAgent.ts

# A2A client agent
npx tsx examples/a2aClientAgent.ts
```

## Logging

The library uses Winston for structured logging:

```typescript
import { loggers } from 'ain-adk/utils/logger';

loggers.agent.info('Agent started');
loggers.intent.debug('Processing query');
loggers.mcp.error('MCP connection failed');
```

Available loggers: `agent`, `intent`, `mcp`, `a2a`, `model`, `server`

## API Endpoints

When running as an A2A server, the following endpoints are available:

- `POST /query` - Process queries through intent analyzer  
- `GET /agent-card` - Get agent card information
- `GET /.well-known/agent.json` - Agent discovery endpoint
- `POST /a2a` - A2A communication endpoint

## License

MIT