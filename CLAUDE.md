# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build the project (creates both ESM and CJS distributions)
npm run build

# Build only ESM format
npm run build:esm

# Build only CJS format  
npm run build:cjs

# Run linting
npm run lint

# Run tests
npm run test

# Run examples
npx tsx examples/simpleAgent.ts
npx tsx examples/a2aClientAgent.ts
```

## Architecture Overview

This is the AI Network Agent Development Kit (AIN-ADK), a TypeScript library for building AI agents with multiple protocol support.

### Core Components

**AINAgent** (`src/ainagent.ts`): Main Express.js server class that orchestrates agent functionality. Can be configured as a standalone agent or A2A server.

**IntentAnalyzer** (`src/intent/analyzer.ts`): Central orchestrator that processes queries through intent analysis and tool execution. Manages the conversation flow with function calling and tool result processing.

**Protocol Modules**:
- **MCP (Model Context Protocol)** (`src/intent/modules/mcp/`): Enables integration with MCP servers for external tool access
- **A2A (Agent-to-Agent)** (`src/intent/modules/a2a/`): Implements agent-to-agent communication protocol for multi-agent workflows

**Models** (`src/models/`): Abstraction layer for AI models with OpenAI/Azure OpenAI implementation.

### Key Architectural Patterns

- **Dual Build System**: Supports both ESM and CJS output formats for maximum compatibility
- **Modular Tool System**: Tools are protocol-agnostic through the `AgentTool` interface
- **Intent-Driven Processing**: Queries flow through intent analysis → tool selection → response generation
- **A2A Server Mode**: Can function as both client and server in agent-to-agent communication

### Environment Setup

Required environment variables for Azure OpenAI:
- `AZURE_OPENAI_PTU_BASE_URL`
- `AZURE_OPENAI_PTU_API_KEY` 
- `AZURE_OPENAI_PTU_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `PORT` (optional, defaults to 3100/5050)

For MCP integration with Notion:
- `NOTION_API_KEY`

### Development Notes

- Uses TypeScript with strict configuration
- Jest for testing with `--passWithNoTests` flag
- ESLint for code quality
- Express.js with CORS enabled
- Import paths use `@/` alias for `src/`

### Logging System

The codebase uses Winston for structured logging with console output. Available loggers:

```typescript
import { loggers } from '@/utils/logger.js';

loggers.agent.info('message');     // AINAgent logs
loggers.intent.debug('message');   // IntentAnalyzer logs  
loggers.mcp.error('message');      // MCP client logs
loggers.a2a.warn('message');       // A2A module logs
loggers.model.info('message');     // Model logs
loggers.server.error('message');   // A2A server logs
```

Log levels: `error`, `warn`, `info`, `debug`. Set `LOG_LEVEL` environment variable to control output level.