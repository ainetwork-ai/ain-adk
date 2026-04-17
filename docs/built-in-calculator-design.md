# Built-in Calculator Design

## Goal

Add a non-breaking, built-in deterministic calculator to AIN-ADK so that:

- orchestrator agents can avoid free-form LLM arithmetic
- analysis agents built on the same ADK can use the same arithmetic rules
- existing A2A, MCP, and text-only flows keep working unchanged by default

## Scope

This first iteration is intentionally small:

- built-in service, not a new public module
- simple arithmetic only: add, subtract, multiply, divide
- exact decimal-safe arithmetic using strings internally
- opt-in exposure as a tool for model calls
- optional use during aggregation/report composition

Out of scope for v1:

- complex statistical functions
- table-aware structured artifacts over A2A
- automatic parsing/recomputation of arbitrary numbers from free-form text

## Non-Breaking Constraints

- existing constructors must continue to work
- new configuration must be optional
- default behavior must remain unchanged
- existing A2A response format remains text-first
- current aggregation fallback must remain available

## Architecture

### 1. Built-in `CalculatorService`

Add an internal service at `src/services/calculator.service.ts`.

Responsibilities:

- perform decimal-safe arithmetic
- normalize operands
- apply deterministic rounding
- format results as strings
- expose an optional built-in tool definition

### 2. Optional runtime config

Extend agent options with an optional calculator config.

Suggested shape:

```ts
type CalculatorOptions = {
  enabled?: boolean;
  exposeAsTool?: boolean;
  defaultScale?: number;
  roundingMode?: "half_up" | "down" | "half_even";
};
```

Default behavior:

- `enabled: false`
- `exposeAsTool: true`
- `defaultScale: 4`
- `roundingMode: "half_up"`

If disabled, the ADK should behave exactly as it does today.

### 3. Built-in tool exposure

When enabled, the calculator is exposed to the LLM as a built-in tool through the
existing tool execution loop.

Tool name:

- `builtin_calculator`

Supported operations:

- `add`
- `subtract`
- `multiply`
- `divide`

Input contract:

```json
{
  "thinking_text": "why this tool is needed",
  "operation": "divide",
  "operands": ["125000", "12"],
  "scale": 4,
  "roundingMode": "half_up"
}
```

Output contract:

```json
{
  "ok": true,
  "operation": "divide",
  "operands": ["125000", "12"],
  "result": "10416.6667",
  "scale": 4,
  "roundingMode": "half_up"
}
```

### 4. Aggregation strategy

Keep the existing `AggregateService` public shape, but allow it to use the
built-in calculator when available.

Execution order:

1. aggregate/report generation starts
2. if calculator is enabled, tool use is available during aggregation
3. if no tool is used, the existing LLM aggregation path still works

This keeps the fallback path intact while giving the model a deterministic
arithmetic option.

## Planned File Changes

### New files

- `docs/built-in-calculator-design.md`
- `src/types/numeric.ts`
- `src/services/calculator.service.ts`
- `src/services/calculator.service.test.ts`

### Modified files

- `src/index.ts`
- `src/config/options.ts`
- `src/types/agent.ts`
- `src/types/connector.ts`
- `src/container/services.ts`
- `src/services/prompts/fulfill.ts`
- `src/services/prompts/aggregate.ts`
- `src/services/intents/fulfill.service.ts`
- `src/services/intents/aggregate.service.ts`

## Execution Rules

- the LLM should not perform arithmetic itself when the built-in calculator is available
- arithmetic results must come from the calculator output
- all calculator results are represented as strings
- division by zero must return a structured error result

## Future Extensions

If this works well, later versions can add:

- percentage/ratio helpers
- typed artifacts for numeric results
- A2A-side structured numeric payloads
- deterministic validation of final report metrics
