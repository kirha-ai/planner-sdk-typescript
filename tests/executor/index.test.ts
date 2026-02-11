import { describe, expect, it } from "bun:test";
import {
  executePlan,
  resolveArguments,
  resolveValue,
} from "../../src/executor";
import { PlanStepStatus } from "../../src/types";
import type { PlanStep, Tool } from "../../src/types";

describe("resolveValue", () => {
  it("should return primitive values as-is", () => {
    const outputs = new Map<string, unknown>();

    expect(resolveValue("hello", outputs)).toBe("hello");
    expect(resolveValue(123, outputs)).toBe(123);
    expect(resolveValue(true, outputs)).toBe(true);
    expect(resolveValue(null, outputs)).toBe(null);
  });

  it("should resolve dependency reference", () => {
    const outputs = new Map<string, unknown>([
      ["step-1", { price: 50000, currency: "USD" }],
    ]);

    const ref = { $fromStep: "step-1", $outputKey: "price" };
    expect(resolveValue(ref, outputs)).toBe(50000);
  });

  it("should resolve nested dependency reference", () => {
    const outputs = new Map<string, unknown>([
      ["step-1", { data: { user: { name: "Alice" } } }],
    ]);

    const ref = { $fromStep: "step-1", $outputKey: "data.user.name" };
    expect(resolveValue(ref, outputs)).toBe("Alice");
  });

  it("should resolve dependency reference with array access in outputKey", () => {
    const outputs = new Map<string, unknown>([
      ["step-1", { items: [{ name: "first" }, { name: "second" }] }],
    ]);

    const ref = { $fromStep: "step-1", $outputKey: "items.0.name" };
    expect(resolveValue(ref, outputs)).toBe("first");

    const ref2 = { $fromStep: "step-1", $outputKey: "items.1.name" };
    expect(resolveValue(ref2, outputs)).toBe("second");
  });

  it("should resolve template string", () => {
    const outputs = new Map<string, unknown>([
      ["step-1", { name: "Bitcoin", symbol: "BTC" }],
    ]);

    const template = {
      $fromTemplateString: "Latest news about {0} ({1})",
      $values: [
        { $fromStep: "step-1", $outputKey: "name" },
        { $fromStep: "step-1", $outputKey: "symbol" },
      ],
    };

    expect(resolveValue(template, outputs)).toBe(
      "Latest news about Bitcoin (BTC)",
    );
  });

  it("should resolve template string with number value", () => {
    const outputs = new Map<string, unknown>([["step-1", { temperature: 42 }]]);

    const template = {
      $fromTemplateString: "Temperature is {0} degrees",
      $values: [{ $fromStep: "step-1", $outputKey: "temperature" }],
    };

    expect(resolveValue(template, outputs)).toBe("Temperature is 42 degrees");
  });

  it("should resolve array of values", () => {
    const outputs = new Map<string, unknown>([
      ["step-1", { a: 1 }],
      ["step-2", { b: 2 }],
    ]);

    const arr = [
      { $fromStep: "step-1", $outputKey: "a" },
      { $fromStep: "step-2", $outputKey: "b" },
      "static",
    ];

    expect(resolveValue(arr, outputs)).toEqual([1, 2, "static"]);
  });

  it("should resolve nested objects", () => {
    const outputs = new Map<string, unknown>([["step-1", { value: 42 }]]);

    const obj = {
      static: "hello",
      dynamic: { $fromStep: "step-1", $outputKey: "value" },
      nested: {
        also: { $fromStep: "step-1", $outputKey: "value" },
      },
    };

    expect(resolveValue(obj, outputs)).toEqual({
      static: "hello",
      dynamic: 42,
      nested: {
        also: 42,
      },
    });
  });

  it("should throw error for missing step output", () => {
    const outputs = new Map<string, unknown>();
    const ref = { $fromStep: "missing-step", $outputKey: "value" };

    expect(() => resolveValue(ref, outputs)).toThrow(
      "Step missing-step output not found",
    );
  });
});

describe("resolveArguments", () => {
  it("should resolve all arguments", () => {
    const outputs = new Map<string, unknown>([["step-1", { price: 50000 }]]);

    const args = {
      staticArg: "hello",
      dynamicArg: { $fromStep: "step-1", $outputKey: "price" },
    };

    expect(resolveArguments(args, outputs)).toEqual({
      staticArg: "hello",
      dynamicArg: 50000,
    });
  });
});

describe("executePlan", () => {
  const createTool = (
    name: string,
    handler: (args: unknown) => Promise<unknown>,
  ): Tool => ({
    name,
    description: `Tool ${name}`,
    inputSchema: "{}",
    outputSchema: "{}",
    handler,
  });

  it("should execute a single step", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "testTool",
        arguments: { input: "hello" },
      },
    ];

    const tools = [
      createTool("testTool", async (args) => ({
        result: (args as { input: string }).input.toUpperCase(),
      })),
    ];

    const results = await executePlan(steps, { tools });

    expect(results).toHaveLength(1);
    expect(results[0]?.stepId).toBe("step-1");
    expect(results[0]?.output).toEqual({ result: "HELLO" });
    expect(results[0]?.error).toBeUndefined();
  });

  it("should execute steps with dependencies in order", async () => {
    const executionOrder: string[] = [];

    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "firstTool",
        arguments: { value: 10 },
      },
      {
        stepId: "step-2",
        status: PlanStepStatus.Pending,
        toolName: "secondTool",
        arguments: {
          input: { $fromStep: "step-1", $outputKey: "result" },
        },
      },
    ];

    const tools = [
      createTool("firstTool", async (args) => {
        executionOrder.push("first");
        return { result: (args as { value: number }).value * 2 };
      }),
      createTool("secondTool", async (args) => {
        executionOrder.push("second");
        return { doubled: (args as { input: number }).input * 2 };
      }),
    ];

    const results = await executePlan(steps, { tools });

    expect(executionOrder).toEqual(["first", "second"]);
    expect(results).toHaveLength(2);
    expect(results[0]?.output).toEqual({ result: 20 });
    expect(results[1]?.output).toEqual({ doubled: 40 });
  });

  it("should execute independent steps in parallel", async () => {
    const startTimes: Record<string, number> = {};

    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "slowTool",
        arguments: { id: "a" },
      },
      {
        stepId: "step-2",
        status: PlanStepStatus.Pending,
        toolName: "slowTool",
        arguments: { id: "b" },
      },
    ];

    const tools = [
      createTool("slowTool", async (args) => {
        const id = (args as { id: string }).id;
        startTimes[id] = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        return { id };
      }),
    ];

    const results = await executePlan(steps, { tools });

    expect(results).toHaveLength(2);

    const timeA = startTimes.a ?? 0;
    const timeB = startTimes.b ?? 0;
    expect(Math.abs(timeA - timeB)).toBeLessThan(20);
  });

  it("should skip step when tool not found", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "nonExistentTool",
        arguments: {},
      },
    ];

    const results = await executePlan(steps, { tools: [] });

    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBe('Tool "nonExistentTool" not found');
    expect(results[0]?.output).toBeNull();
  });

  it("should handle tool execution error", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "failingTool",
        arguments: {},
      },
    ];

    const tools = [
      createTool("failingTool", async () => {
        throw new Error("Tool execution failed");
      }),
    ];

    const results = await executePlan(steps, { tools });

    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBe("Tool execution failed");
    expect(results[0]?.output).toBeNull();
  });

  it("should skip dependent steps when dependency fails", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "failingTool",
        arguments: {},
      },
      {
        stepId: "step-2",
        status: PlanStepStatus.Pending,
        toolName: "dependentTool",
        arguments: {
          input: { $fromStep: "step-1", $outputKey: "result" },
        },
      },
    ];

    const tools = [
      createTool("failingTool", async () => {
        throw new Error("First step failed");
      }),
      createTool("dependentTool", async (args) => ({ received: args })),
    ];

    const results = await executePlan(steps, { tools });

    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBe("First step failed");
    expect(results[1]?.error).toContain("Skipped");
  });

  it("should resolve template strings during execution", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "getCoin",
        arguments: {},
      },
      {
        stepId: "step-2",
        status: PlanStepStatus.Pending,
        toolName: "search",
        arguments: {
          query: {
            $fromTemplateString: "News about {0} ({1})",
            $values: [
              { $fromStep: "step-1", $outputKey: "name" },
              { $fromStep: "step-1", $outputKey: "symbol" },
            ],
          },
        },
      },
    ];

    const tools = [
      createTool("getCoin", async () => ({ name: "Bitcoin", symbol: "BTC" })),
      createTool("search", async (args) => ({
        searchQuery: (args as { query: string }).query,
      })),
    ];

    const results = await executePlan(steps, { tools });

    expect(results).toHaveLength(2);
    expect(results[1]?.output).toEqual({
      searchQuery: "News about Bitcoin (BTC)",
    });
  });

  it("should return results in step order", async () => {
    const steps: PlanStep[] = [
      {
        stepId: "step-1",
        status: PlanStepStatus.Pending,
        toolName: "slowTool",
        arguments: { delay: 50 },
      },
      {
        stepId: "step-2",
        status: PlanStepStatus.Pending,
        toolName: "fastTool",
        arguments: {},
      },
    ];

    const tools = [
      createTool("slowTool", async (args) => {
        await new Promise((r) =>
          setTimeout(r, (args as { delay: number }).delay),
        );
        return { id: "slow" };
      }),
      createTool("fastTool", async () => ({ id: "fast" })),
    ];

    const results = await executePlan(steps, { tools });

    expect(results[0]?.stepId).toBe("step-1");
    expect(results[1]?.stepId).toBe("step-2");
  });
});
