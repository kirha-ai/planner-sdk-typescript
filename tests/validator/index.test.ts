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
