import { describe, expect, it } from "bun:test";
import { isValidPlan } from "../../src/index";
import { PlanStepStatus, type PlanStep, type Tool } from "../../src/types";

const tools: Tool[] = [
  {
    name: "getWeather",
    description: "Get weather for a location",
    inputSchema:
      '{"type":"object","properties":{"location":{"type":"string"}}}',
    outputSchema:
      '{"type":"object","properties":{"temperature":{"type":"number"}}}',
    handler: async () => ({ temperature: 20 }),
  },
  {
    name: "sendEmail",
    description: "Send an email",
    inputSchema: '{"type":"object","properties":{"body":{"type":"string"}}}',
    outputSchema: '{"type":"object","properties":{"sent":{"type":"boolean"}}}',
    handler: async () => ({ sent: true }),
  },
  {
    name: "formatMessage",
    description: "Format a message",
    inputSchema: '{"type":"object","properties":{"value":{"type":"string"}}}',
    outputSchema:
      '{"type":"object","properties":{"message":{"type":"string"}}}',
    handler: async () => ({ message: "ok" }),
  },
];

const stepOne: PlanStep = {
  stepId: "step-1",
  status: PlanStepStatus.Pending,
  toolName: "getWeather",
  arguments: { location: "Paris" },
};

const stepTwo: PlanStep = {
  stepId: "step-2",
  status: PlanStepStatus.Pending,
  toolName: "sendEmail",
  arguments: {
    body: { $fromStep: "step-1", $outputKey: "temperature" },
  },
};

const stepMessage: PlanStep = {
  stepId: "step-3",
  status: PlanStepStatus.Pending,
  toolName: "formatMessage",
  arguments: {
    value: "Hello",
  },
};

const stepSendValid: PlanStep = {
  stepId: "step-4",
  status: PlanStepStatus.Pending,
  toolName: "sendEmail",
  arguments: {
    body: { $fromStep: "step-3", $outputKey: "message" },
  },
};

describe("isValidPlan", () => {
  it("returns type mismatch errors", () => {
    const result = isValidPlan([stepOne, stepTwo], tools);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("type_mismatch");
    expect(result.errors[0]?.argumentPath).toBe("body");
  });

  it("returns output key missing errors", () => {
    const result = isValidPlan(
      [
        stepOne,
        {
          ...stepTwo,
          stepId: "step-5",
          arguments: {
            body: { $fromStep: "step-1", $outputKey: "humidity" },
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("output_key_missing");
  });

  it("returns tool not found errors", () => {
    const result = isValidPlan(
      [
        {
          ...stepOne,
          stepId: "step-6",
          toolName: "missingTool",
        },
      ],
      tools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("tool_not_found");
  });

  it("returns schema parse errors", () => {
    const badTools: Tool[] = [
      {
        name: "badTool",
        description: "Bad tool",
        inputSchema: "{invalid: schema}",
        outputSchema: '{"type":"object","properties":{}}',
        handler: async () => ({}),
      },
    ];

    const result = isValidPlan(
      [
        {
          ...stepOne,
          stepId: "step-7",
          toolName: "badTool",
        },
      ],
      badTools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("schema_parse_error");
  });

  it("returns dependency step missing errors", () => {
    const result = isValidPlan(
      [
        {
          ...stepTwo,
          stepId: "step-8",
          arguments: {
            body: { $fromStep: "missing-step", $outputKey: "temperature" },
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("dependency_step_missing");
  });

  it("returns input key missing errors", () => {
    const result = isValidPlan(
      [
        {
          ...stepTwo,
          stepId: "step-9",
          arguments: {
            subject: { $fromStep: "step-1", $outputKey: "temperature" },
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("input_key_missing");
  });

  it("returns string template type mismatch errors", () => {
    const numericTool: Tool = {
      name: "needsNumber",
      description: "Needs a number",
      inputSchema: '{"type":"object","properties":{"value":{"type":"number"}}}',
      outputSchema: '{"type":"object","properties":{}}',
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        stepOne,
        {
          stepId: "step-10",
          status: PlanStepStatus.Pending,
          toolName: "needsNumber",
          arguments: {
            value: {
              $fromTemplateString: "Value {0}",
              $values: [{ $fromStep: "step-1", $outputKey: "temperature" }],
            },
          },
        },
      ],
      [...tools, numericTool],
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("type_mismatch");
  });

  it("returns valid when schemas match", () => {
    const result = isValidPlan([stepMessage, stepSendValid], tools);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates references nested in arrays", () => {
    const arrayTool: Tool = {
      name: "processItems",
      description: "Process items",
      inputSchema:
        '{"type":"object","properties":{"items":{"type":"array","items":{"type":"string"}}}}',
      outputSchema: '{"type":"object","properties":{}}',
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        stepMessage,
        {
          stepId: "step-array",
          status: PlanStepStatus.Pending,
          toolName: "processItems",
          arguments: {
            items: ["static", { $fromStep: "step-3", $outputKey: "message" }],
          },
        },
      ],
      [...tools, arrayTool],
    );

    expect(result.valid).toBe(true);
  });

  it("validates references with bracket notation in outputKey", () => {
    const arrayOutputTool: Tool = {
      name: "getItems",
      description: "Get items",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema:
        '{"type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}}}}}}',
      handler: async () => ({ items: [{ name: "test" }] }),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-get",
          status: PlanStepStatus.Pending,
          toolName: "getItems",
          arguments: {},
        },
        {
          stepId: "step-send",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "step-get", $outputKey: "items.0.name" },
          },
        },
      ],
      [...tools, arrayOutputTool],
    );

    expect(result.valid).toBe(true);
  });

  it("accepts number output interpolated in string template for string field", () => {
    const result = isValidPlan(
      [
        stepOne,
        {
          stepId: "step-num-tpl",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "Temperature is {0} degrees",
              $values: [{ $fromStep: "step-1", $outputKey: "temperature" }],
            },
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts object output interpolated in string template", () => {
    const objectOutputTool: Tool = {
      name: "getData",
      description: "Get data",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema:
        '{"type":"object","properties":{"result":{"type":"object","properties":{"key":{"type":"string"}}}}}',
      handler: async () => ({ result: { key: "value" } }),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-obj",
          status: PlanStepStatus.Pending,
          toolName: "getData",
          arguments: {},
        },
        {
          stepId: "step-obj-tpl",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "Data: {0}",
              $values: [{ $fromStep: "step-obj", $outputKey: "result" }],
            },
          },
        },
      ],
      [...tools, objectOutputTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts object inside array output interpolated in string template", () => {
    const objectInArrayTool: Tool = {
      name: "getItems",
      description: "Get items",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema:
        '{"type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}}}}}}',
      handler: async () => ({ items: [{ name: "test" }] }),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-items",
          status: PlanStepStatus.Pending,
          toolName: "getItems",
          arguments: {},
        },
        {
          stepId: "step-items-tpl",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "First item: {0}",
              $values: [{ $fromStep: "step-items", $outputKey: "items.0" }],
            },
          },
        },
      ],
      [...tools, objectInArrayTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts array output interpolated in string template", () => {
    const arrayOutputTool: Tool = {
      name: "getTags",
      description: "Get tags",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema:
        '{"type":"object","properties":{"tags":{"type":"array","items":{"type":"string"}}}}',
      handler: async () => ({ tags: ["a", "b"] }),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-arr",
          status: PlanStepStatus.Pending,
          toolName: "getTags",
          arguments: {},
        },
        {
          stepId: "step-arr-tpl",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "Tags: {0}",
              $values: [{ $fromStep: "step-arr", $outputKey: "tags" }],
            },
          },
        },
      ],
      [...tools, arrayOutputTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates valid string template references", () => {
    const result = isValidPlan(
      [
        stepMessage,
        {
          stepId: "step-template",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "Message: {0}",
              $values: [{ $fromStep: "step-3", $outputKey: "message" }],
            },
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(true);
  });

  it("collects multiple errors in one plan", () => {
    const result = isValidPlan(
      [
        {
          stepId: "step-err-1",
          status: PlanStepStatus.Pending,
          toolName: "missingTool",
          arguments: {},
        },
        {
          stepId: "step-err-2",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "missing-step", $outputKey: "value" },
          },
        },
        {
          stepId: "step-err-3",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            wrongKey: "value",
          },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);

    const errorCodes = result.errors.map((e) => e.code);
    expect(errorCodes).toContain("tool_not_found");
    expect(errorCodes).toContain("dependency_step_missing");
  });

  it("resolves output path through anyOf with null (nullable union)", () => {
    const coinTool: Tool = {
      name: "getCoinInfo",
      description: "Get coin info",
      inputSchema:
        '{"type":"object","properties":{"coinId":{"type":"string"}}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          platformInfo: {
            anyOf: [
              {
                type: "object",
                properties: {
                  contractAddress: { type: "string" },
                  decimalPlaces: {
                    anyOf: [{ type: "number" }, { type: "null" }],
                  },
                  platformName: { type: "string" },
                },
                required: ["platformName"],
              },
              { type: "null" },
            ],
          },
        },
        required: ["platformInfo"],
      }),
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-coin",
          status: PlanStepStatus.Pending,
          toolName: "getCoinInfo",
          arguments: { coinId: "bitcoin" },
        },
        {
          stepId: "step-use",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromStep: "step-coin",
              $outputKey: "platformInfo.contractAddress",
            },
          },
        },
      ],
      [...tools, coinTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("resolves output path through oneOf with null (nullable exclusive union)", () => {
    const coinTool: Tool = {
      name: "getCoinOneOf",
      description: "Get coin info",
      inputSchema:
        '{"type":"object","properties":{"coinId":{"type":"string"}}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          platformInfo: {
            oneOf: [
              {
                type: "object",
                properties: {
                  contractAddress: { type: "string" },
                },
                required: ["contractAddress"],
              },
              { type: "null" },
            ],
          },
        },
        required: ["platformInfo"],
      }),
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-coin-oneof",
          status: PlanStepStatus.Pending,
          toolName: "getCoinOneOf",
          arguments: { coinId: "bitcoin" },
        },
        {
          stepId: "step-use-oneof",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromStep: "step-coin-oneof",
              $outputKey: "platformInfo.contractAddress",
            },
          },
        },
      ],
      [...tools, coinTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("resolves output path through multi-branch anyOf union", () => {
    const multiUnionTool: Tool = {
      name: "getMultiResult",
      description: "Get result with multiple union branches",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            anyOf: [
              {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
              },
              {
                type: "object",
                properties: { value: { type: "number" } },
                required: ["value"],
              },
            ],
          },
        },
        required: ["result"],
      }),
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-multi",
          status: PlanStepStatus.Pending,
          toolName: "getMultiResult",
          arguments: {},
        },
        {
          stepId: "step-use-multi",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromTemplateString: "Result: {0}",
              $values: [
                { $fromStep: "step-multi", $outputKey: "result.value" },
              ],
            },
          },
        },
      ],
      [...tools, multiUnionTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("resolves output path present in only one branch of anyOf union", () => {
    const partialUnionTool: Tool = {
      name: "getPartialResult",
      description: "Get result where branches differ",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          result: {
            anyOf: [
              {
                type: "object",
                properties: { address: { type: "string" } },
                required: ["address"],
              },
              {
                type: "object",
                properties: { code: { type: "number" } },
                required: ["code"],
              },
            ],
          },
        },
        required: ["result"],
      }),
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-partial",
          status: PlanStepStatus.Pending,
          toolName: "getPartialResult",
          arguments: {},
        },
        {
          stepId: "step-use-partial",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: {
              $fromStep: "step-partial",
              $outputKey: "result.address",
            },
          },
        },
      ],
      [...tools, partialUnionTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates forward step references", () => {
    const result = isValidPlan(
      [
        {
          stepId: "step-first",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "step-second", $outputKey: "message" },
          },
        },
        {
          stepId: "step-second",
          status: PlanStepStatus.Pending,
          toolName: "formatMessage",
          arguments: { value: "Hello" },
        },
      ],
      tools,
    );

    expect(result.valid).toBe(true);
  });

  it("accepts enum output as string type", () => {
    const enumTool: Tool = {
      name: "getStatus",
      description: "Get status",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
        required: ["status"],
      }),
      handler: async () => ({ status: "active" }),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-enum",
          status: PlanStepStatus.Pending,
          toolName: "getStatus",
          arguments: {},
        },
        {
          stepId: "step-use-enum",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "step-enum", $outputKey: "status" },
          },
        },
      ],
      [...tools, enumTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts const/literal output matching expected type", () => {
    const constTool: Tool = {
      name: "getConst",
      description: "Get a constant",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          label: { const: "fixed-label" },
          code: { const: 42 },
        },
        required: ["label", "code"],
      }),
      handler: async () => ({ label: "fixed-label", code: 42 }),
    };

    const stringResult = isValidPlan(
      [
        {
          stepId: "step-const",
          status: PlanStepStatus.Pending,
          toolName: "getConst",
          arguments: {},
        },
        {
          stepId: "step-use-label",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "step-const", $outputKey: "label" },
          },
        },
      ],
      [...tools, constTool],
    );

    expect(stringResult.valid).toBe(true);
    expect(stringResult.errors).toHaveLength(0);

    const numberResult = isValidPlan(
      [
        {
          stepId: "step-const",
          status: PlanStepStatus.Pending,
          toolName: "getConst",
          arguments: {},
        },
        {
          stepId: "step-use-code",
          status: PlanStepStatus.Pending,
          toolName: "sendEmail",
          arguments: {
            body: { $fromStep: "step-const", $outputKey: "code" },
          },
        },
      ],
      [...tools, constTool],
    );

    expect(numberResult.valid).toBe(false);
    expect(numberResult.errors[0]?.code).toBe("type_mismatch");
  });

  it("accepts tuple output as array type", () => {
    const tupleTool: Tool = {
      name: "getCoords",
      description: "Get coordinates",
      inputSchema: '{"type":"object","properties":{}}',
      outputSchema: JSON.stringify({
        type: "object",
        properties: {
          coords: {
            type: "array",
            prefixItems: [{ type: "number" }, { type: "number" }],
          },
        },
        required: ["coords"],
      }),
      handler: async () => ({ coords: [1, 2] }),
    };

    const arrayInputTool: Tool = {
      name: "processArray",
      description: "Process array",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {
          items: { type: "array", items: { type: "number" } },
        },
      }),
      outputSchema: '{"type":"object","properties":{}}',
      handler: async () => ({}),
    };

    const result = isValidPlan(
      [
        {
          stepId: "step-tuple",
          status: PlanStepStatus.Pending,
          toolName: "getCoords",
          arguments: {},
        },
        {
          stepId: "step-use-tuple",
          status: PlanStepStatus.Pending,
          toolName: "processArray",
          arguments: {
            items: { $fromStep: "step-tuple", $outputKey: "coords" },
          },
        },
      ],
      [...tools, tupleTool, arrayInputTool],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates union types in schemas", () => {
    const unionTool: Tool = {
      name: "processValue",
      description: "Process a value",
      inputSchema:
        '{"type":"object","properties":{"value":{"oneOf":[{"type":"string"},{"type":"number"}]}}}',
      outputSchema:
        '{"type":"object","properties":{"result":{"type":"string"}}}',
      handler: async () => ({ result: "ok" }),
    };

    const result = isValidPlan(
      [
        stepMessage,
        {
          stepId: "step-union",
          status: PlanStepStatus.Pending,
          toolName: "processValue",
          arguments: {
            value: { $fromStep: "step-3", $outputKey: "message" },
          },
        },
      ],
      [...tools, unionTool],
    );

    expect(result.valid).toBe(true);
  });
});
