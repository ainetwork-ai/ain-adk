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
yarn lint       # Run linting
yarn format     # Format code
yarn check      # Check code
yarn check:write # Check and auto-fix

# Development mode
yarn dev        # Run TypeScript directly with tsx
```

## Architecture Overview

### Core Components

1. **AINAgent** (`src/app.ts`)
   - Main Express server class that orchestrates all modules
   - Manages authentication middleware
   - Provides HTTP endpoints for agent interaction
   - Implements A2A discovery endpoints when in server mode

2. **Module System**
   - **ModelModule** (`src/modules/models/`): AI model integrations (OpenAI, Gemini)
   - **MCPModule** (`src/modules/mcp/`): Model Context Protocol client connections
   - **A2AModule** (`src/modules/a2a/`): Agent-to-Agent communication
   - **MemoryModule** (`src/modules/memory/`): Session and memory management

3. **Controller Layer** (`src/controllers/`)
   - `query.controller.ts`: Handles query processing endpoints
   - `a2a.controller.ts`: Manages A2A-specific endpoints

4. **Tool Abstraction**
   - Unified `IAgentTool` interface for protocol-agnostic tool execution
   - Supports tools from both MCP servers and A2A agents

5. **FOL Module** (`src/intent/modules/fol/`)
   - First-Order Logic reasoning capabilities
   - Multiple storage backends: local, MongoDB, PostgreSQL
   - Facts representation with constants, predicates, and facts

### Key Patterns

1. **Module Registration**: All modules follow a consistent registration pattern with the main agent
2. **Tool Execution**: Tools are executed through a unified interface regardless of source (MCP/A2A)
3. **Logging**: Use service-specific loggers (e.g., `getLogger("mcp")`, `getLogger("a2a")`)
4. **Error Handling**: Global error middleware handles all uncaught errors
5. **Type Safety**: Extensive use of TypeScript interfaces and types throughout

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
   - A2A endpoints: `/a2a` (only available in A2A server mode)
   - Health/discovery endpoints for A2A protocol

4. **Testing**
   - Use Jest for unit tests
   - Test files should use `.test.ts` extension
   - Mock external dependencies appropriately

### Environment Configuration

The project uses environment variables for configuration. Key variables include:
- Model API keys (OpenAI, Google)
- Server configuration
- A2A settings
- Database connections for FOL storage

### Build Considerations

- The project outputs both ESM and CJS formats
- TypeScript path alias `@/` maps to `src/`
- Target is ES2021 with Node16 module resolution
- Strict TypeScript mode is enabled