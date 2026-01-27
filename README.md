# @kirha/planner

SDK to interact with, parse, validate, and execute execution plans from [kirha/planner](https://huggingface.co/kirha/planner) - a fine-tuned LLM for tool planning. See the [kirha/kirha-planner collection](https://huggingface.co/collections/kirha/kirha-planner) for quantized models.

Compatible with any OpenAI chat completion compatible endpoint.

## Overview

This SDK is designed to work with [kirha/planner](https://huggingface.co/kirha/planner), a Qwen3 8b model fine-tuned to generate complete DAG (Directed Acyclic Graph) execution plans from natural language queries.

Instead of step-by-step function calling, the model outputs a full execution plan in one pass. This SDK handles:

- **Interaction**: Send queries to the model with your tool definitions
- **Parsing**: Extract and validate the structured plan from model output
- **Validation**: Verify plan correctness against tool schemas (dependency references, type mismatches)
- **Execution**: Run all steps with automatic dependency resolution

## Installation

```bash
npm install @kirha/planner
# or
bun add @kirha/planner
```

## Running the Model

On Mac (Apple Silicon), you can run the model locally using MLX:

```bash
# Install mlx-lm
pip install mlx-lm

# Start the server
mlx_lm.server --model kirha/planner-mlx-4bit
```

The server will start on `http://localhost:8080` with an OpenAI-compatible API.

Any OpenAI chat completion compatible endpoint can be used (vLLM, Ollama, etc.).

## Quick Start

```typescript
import { Planner } from "@kirha/planner";

// Define your tools
const tools = [
  {
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
      },
      required: ["city"],
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        temperature: { type: "number" },
        condition: { type: "string" },
      },
    }),
    handler: async ({ city }) => ({
      temperature: 22,
      condition: "sunny",
    }),
  },
];

// Create a planner instance
const planner = new Planner("http://localhost:8080/v1", {
  model: "kirha/planner",
});

// Generate a plan from natural language
const plan = await planner.generatePlan("What's the weather in Paris?", {
  tools,
});

// Execute the plan
if (plan) {
  const results = await plan.execute({ tools });
  console.log(results);
}
```

## API Reference

### `Planner`

Main class for generating execution plans.

```typescript
const planner = new Planner(baseUrl: string, options: {
  apiKey?: string;    // API key for authentication
  model?: string;     // Model name (default: "kirha/planner")
});
```

#### `planner.generatePlan(query, options)`

Generates an execution plan from a natural language query.

```typescript
const plan = await planner.generatePlan(query: string, {
  tools: Tool[];           // Available tools
  instructions?: string;   // Additional instructions for the model
  temperature?: number;    // Sampling temperature (default: 0)
  maxTokens?: number;      // Max tokens (default: 10000)
});
```

### `Plan`

Represents a generated execution plan.

#### `plan.execute(options)`

Executes all steps in the plan with automatic dependency resolution.

```typescript
const results = await plan.execute({
  tools: Tool[];  // Tool implementations with handlers
});
```

### Types

#### `Tool`

```typescript
interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: string; // JSON Schema as string
  outputSchema: string; // JSON Schema as string
  handler: (args: TInput) => Promise<TOutput>;
}
```

#### `StepResult`

```typescript
interface StepResult {
  stepId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  output: unknown;
  error?: string;
}
```

## Parsing

The SDK parses the model's raw output into a structured, executable plan.

### Model Output Format

The model generates a `<think>` block for reasoning followed by a `<plan>` block:

```
<think>
I need to first get the user's location, then fetch the weather.
</think>
<plan>
[
  {
    "thought": "Get user location",
    "toolName": "get_location",
    "arguments": { "userId": "123" }
  },
  {
    "thought": "Get weather for the location",
    "toolName": "get_weather",
    "arguments": { "city": "{0.city}" }
  }
]
</plan>
```

### Step Structure

Each step in the plan contains:

```typescript
{
  stepId: string;      // Unique identifier for this step
  toolName: string;    // Name of the tool to execute
  arguments: object;   // Parameters with possible references
  thought?: string;    // Model's reasoning for this step
}
```

### Dependency References

Steps can reference outputs from previous steps. The parser transforms these into structured references.

#### Template String References

When a string contains `{index}` or `{index.path}` patterns, it's parsed as a template:

```json
// Model output
{ "city": "{0.location}" }

// Parsed to
{
  "city": {
    "$fromTemplateString": "{0}",
    "$values": [
      { "$fromStep": "0", "$outputKey": "location" }
    ]
  }
}
```

With multiple references or surrounding text:

```json
// Model output
{ "message": "Weather in {0.city}: {1.temperature}°C" }

// Parsed to
{
  "message": {
    "$fromTemplateString": "Weather in {0}: {1}°C",
    "$values": [
      { "$fromStep": "0", "$outputKey": "city" },
      { "$fromStep": "1", "$outputKey": "temperature" }
    ]
  }
}
```

#### Object References

The model can also output explicit reference objects:

```json
// Model output
{ "city": { "fromStep": 0, "outputKey": "location" } }

// Parsed to
{ "city": { "$fromStep": "0", "$outputKey": "location" } }
```

#### Supported Patterns

Template string patterns:

- `{0}` - Reference entire output from step 0
- `{0.field}` - Reference `field` from step 0's output
- `{1.data.nested}` - Reference nested field from step 1
- `{0.items[0].name}` - Reference array element (bracket notation converted to dot notation)

## Validation

The SDK can validate a parsed plan against your tool definitions before execution, catching issues like missing tools, invalid dependency references, and type mismatches.

### `isValidPlan(steps, tools)`

```typescript
import { isValidPlan } from "@kirha/planner";

const result = isValidPlan(plan.steps, tools);

if (!result.valid) {
  console.error("Plan validation errors:", result.errors);
}
```

### `PlanValidationResult`

```typescript
interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationError[];
}
```

### `PlanValidationError`

```typescript
interface PlanValidationError {
  code: string;
  message: string;
  stepId?: string;
  toolName?: string;
  argumentPath?: string;
  fromStepId?: string;
  outputPath?: string;
  expectedType?: string;
  actualType?: string;
}
```

## Execution

The executor runs all steps with automatic dependency resolution and parallel execution where possible.

### Execution Flow

1. **Dependency Analysis**: Extract all step dependencies from arguments
2. **Eager Execution**: Steps without pending dependencies start immediately
3. **Parallel Execution**: Independent steps run concurrently
4. **Resolution**: When a step completes, its dependents become eligible
5. **Ordering**: Results are returned in original step order

### DAG Execution

The executor treats the plan as a Directed Acyclic Graph (DAG).

**Query**: _"What is the profit and loss of the largest USDC holder on Base?"_

```json
[
  { "toolName": "getChainId", "arguments": { "blockchain": "Base" } },
  { "toolName": "searchCoin", "arguments": { "query": "USDC", "limit": 1 } },
  {
    "toolName": "getCoinPlatformInfo",
    "arguments": {
      "coinId": { "fromStep": 1, "outputKey": "coins.0.id" },
      "platform": "base"
    }
  },
  {
    "toolName": "getTokenHolders",
    "arguments": {
      "chainId": { "fromStep": 0, "outputKey": "chainId" },
      "tokenAddress": { "fromStep": 2, "outputKey": "contractAddress" },
      "limit": 1
    }
  },
  {
    "toolName": "getWalletPnL",
    "arguments": {
      "address": { "fromStep": 3, "outputKey": "holders.0.address" }
    }
  }
]
```

Execution graph:

```
Step 0: getChainId        Step 1: searchCoin
    │                         │
    │                         ↓
    │                     Step 2: getCoinPlatformInfo
    │                         │
    └────────────┬────────────┘
                 ↓
         Step 3: getTokenHolders
                 │
                 ↓
         Step 4: getWalletPnL
```

Execution timeline:

1. Steps 0 and 1 start in parallel (no dependencies)
2. Step 2 starts once step 1 completes
3. Step 3 waits for both steps 0 and 2 to complete
4. Step 4 starts once step 3 completes

### Error Handling

- **Tool not found**: Step is skipped with an error message
- **Argument resolution failed**: Step is skipped
- **Tool execution failed**: Step marked as failed, dependents are skipped
- **Unsatisfied dependencies**: Steps are skipped at the end

### Step Results

Each step returns a `StepResult`:

```typescript
{
  stepId: string;                    // Step identifier
  toolName: string;                  // Tool that was called
  arguments: Record<string, unknown>; // Resolved arguments
  output: unknown;                   // Tool return value
  error?: string;                    // Error message if failed
}
```

## License

MIT
