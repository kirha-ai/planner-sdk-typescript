import { describe, expect, it } from "bun:test";
import { parseModelOutput, parsePlanSteps } from "../../src/parser";
import { PlanStepStatus } from "../../src/types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("parsePlanSteps", () => {
  it("should parse empty array input", () => {
    const stringPlan = JSON.stringify([]);
    const planSteps = parsePlanSteps(stringPlan);
    expect(planSteps).toEqual([]);
  });

  it("should parse simple plan with no dependencies", () => {
    const stringPlan = JSON.stringify([
      {
        toolName: "getBitcoinPrice",
        thought: "I need to get the current Bitcoin price",
        arguments: { currency: "USD" },
      },
    ]);

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(1);
    const step = planSteps[0];
    expect(step).toBeDefined();
    expect(step?.stepId).toMatch(UUID_REGEX);
    expect(step?.status).toBe(PlanStepStatus.Pending);
    expect(step?.toolName).toBe("getBitcoinPrice");
    expect(step?.arguments).toEqual({ currency: "USD" });
    expect(step?.thought).toBe("I need to get the current Bitcoin price");
  });

  it("should parse complex nested structures with dependencies", () => {
    const stringPlan = JSON.stringify([
      {
        toolName: "getWeatherData",
        arguments: { location: "New York", units: "metric" },
      },
      {
        toolName: "analyzeWeatherTrend",
        arguments: {
          data: {
            fromStep: 0,
            outputKey: "forecast.daily",
          },
          options: {
            includeTemperature: true,
            includePrecipitation: true,
            customSettings: {
              temperatureThreshold: 25,
              precipitationData: {
                fromStep: 0,
                outputKey: "forecast.precipitation",
              },
            },
          },
        },
      },
      {
        toolName: "generateWeatherReport",
        arguments: {
          analysis: {
            fromStep: 1,
            outputKey: "trend",
          },
          format: "markdown",
          includeData: [
            {
              fromStep: 0,
              outputKey: "forecast.summary",
            },
            {
              fromStep: 1,
              outputKey: "charts.temperature",
            },
          ],
        },
      },
    ]);

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(3);

    const step0 = planSteps[0];
    const step1 = planSteps[1];
    const step2 = planSteps[2];

    if (!step0 || !step1 || !step2) {
      throw new Error("Steps should be defined");
    }

    const firstStepId = step0.stepId;
    const secondStepId = step1.stepId;
    const thirdStepId = step2.stepId;

    expect(firstStepId).toMatch(UUID_REGEX);
    expect(secondStepId).toMatch(UUID_REGEX);
    expect(thirdStepId).toMatch(UUID_REGEX);

    expect(step0.toolName).toBe("getWeatherData");
    expect(step0.arguments).toEqual({ location: "New York", units: "metric" });

    expect(step1.toolName).toBe("analyzeWeatherTrend");
    expect(step1.arguments).toEqual({
      data: {
        $fromStep: firstStepId,
        $outputKey: "forecast.daily",
      },
      options: {
        includeTemperature: true,
        includePrecipitation: true,
        customSettings: {
          temperatureThreshold: 25,
          precipitationData: {
            $fromStep: firstStepId,
            $outputKey: "forecast.precipitation",
          },
        },
      },
    });

    expect(step2.toolName).toBe("generateWeatherReport");
    expect(step2.arguments).toEqual({
      analysis: {
        $fromStep: secondStepId,
        $outputKey: "trend",
      },
      format: "markdown",
      includeData: [
        { $fromStep: firstStepId, $outputKey: "forecast.summary" },
        { $fromStep: secondStepId, $outputKey: "charts.temperature" },
      ],
    });
  });

  it("should parse plan with array dependencies", () => {
    const stringPlan = JSON.stringify([
      {
        toolName: "getBitcoinAddressTransactions",
        thought: "think 1",
        arguments: {
          limit: 3,
          address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        },
      },
      {
        toolName: "getBitcoinAddressBalance",
        thought: "think 2",
        arguments: {
          booleanParam: true,
          strParam: "hey",
          address: {
            fromStep: 0,
            outputKey: "transactions.[0].sender",
          },
        },
      },
      {
        toolName: "getBitcoinAddressBalance",
        thought: "think 3",
        arguments: {
          address: [
            {
              fromStep: 0,
              outputKey: "transactions.[0].sender",
            },
            {
              fromStep: 1,
              outputKey: "transactions.1.sender",
            },
          ],
        },
      },
    ]);

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(3);

    const step0 = planSteps[0];
    const step1 = planSteps[1];
    const step2 = planSteps[2];

    if (!step0 || !step1 || !step2) {
      throw new Error("Steps should be defined");
    }

    const firstStepId = step0.stepId;
    const secondStepId = step1.stepId;

    expect(step0.toolName).toBe("getBitcoinAddressTransactions");
    expect(step0.thought).toBe("think 1");

    expect(step1.toolName).toBe("getBitcoinAddressBalance");
    expect(step1.arguments).toEqual({
      booleanParam: true,
      strParam: "hey",
      address: {
        $fromStep: firstStepId,
        $outputKey: "transactions[0].sender",
      },
    });

    expect(step2.toolName).toBe("getBitcoinAddressBalance");
    expect(step2.arguments).toEqual({
      address: [
        {
          $fromStep: firstStepId,
          $outputKey: "transactions[0].sender",
        },
        {
          $fromStep: secondStepId,
          $outputKey: "transactions.1.sender",
        },
      ],
    });
  });

  it("should parse unquoted JSON (JSON5)", () => {
    const stringPlan = `
    [
      {
        toolName: "getBitcoinPrice",
        thought: "I need to get the current Bitcoin price",
        arguments: { currency: "USD" },
      }
    ]
    `;

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(1);
    expect(planSteps[0]?.stepId).toMatch(UUID_REGEX);
    expect(planSteps[0]?.toolName).toBe("getBitcoinPrice");
  });

  it("should parse plan in a code block", () => {
    const stringPlan = `
    \`\`\`json
    [
      {
        toolName: "getBitcoinPrice",
        thought: "I need to get the current Bitcoin price",
        arguments: { currency: "USD" },
      }
    ]
    \`\`\`
    `;

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(1);
    expect(planSteps[0]?.stepId).toMatch(UUID_REGEX);
    expect(planSteps[0]?.toolName).toBe("getBitcoinPrice");
  });

  it("should parse plan with noised start and end", () => {
    const stringPlan = `
    \`\`\`json ewd9ioi
    [
      {
        toolName: "getBitcoinPrice",
        thought: "I need to get the current Bitcoin price",
        arguments: { currency: "USD" },
      }
    ]iojdwejiu|/
    `;

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(1);
    expect(planSteps[0]?.stepId).toMatch(UUID_REGEX);
    expect(planSteps[0]?.toolName).toBe("getBitcoinPrice");
  });

  it("should parse plan with string template", () => {
    const stringPlan = JSON.stringify([
      {
        toolName: "getBitcoinPrice",
        thought: "I need to get the current Bitcoin price",
        arguments: { currency: "USD" },
      },
      {
        toolName: "webSearch",
        thought: "I need to convert the Bitcoin price to EUR",
        arguments: {
          query: "convert {0.price} USD to EUR",
        },
      },
      {
        toolName: "webSearch",
        thought: "Search news about Bitcoin price",
        arguments: {
          query: "latest news on Bitcoin price",
        },
      },
    ]);

    const planSteps = parsePlanSteps(stringPlan);

    expect(planSteps).toHaveLength(3);

    const step0 = planSteps[0];
    const step1 = planSteps[1];
    const step2 = planSteps[2];

    if (!step0 || !step1 || !step2) {
      throw new Error("Steps should be defined");
    }

    const firstStepId = step0.stepId;

    expect(step0.toolName).toBe("getBitcoinPrice");

    expect(step1.toolName).toBe("webSearch");
    expect(step1.arguments).toEqual({
      query: {
        $fromTemplateString: "convert {0} USD to EUR",
        $values: [
          {
            $fromStep: firstStepId,
            $outputKey: "price",
          },
        ],
      },
    });

    expect(step2.toolName).toBe("webSearch");
    expect(step2.arguments).toEqual({
      query: "latest news on Bitcoin price",
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid JSON input", () => {
      const invalidJson = "{invalid: json}";
      expect(() => parsePlanSteps(invalidJson)).toThrow();
    });

    it("should throw error for invalid schema (missing required fields)", () => {
      const missingToolName = JSON.stringify([
        {
          arguments: { currency: "USD" },
        },
      ]);

      expect(() => parsePlanSteps(missingToolName)).toThrow();
    });

    it("should throw error for invalid dependency reference", () => {
      const invalidReference = JSON.stringify([
        {
          toolName: "getBitcoinPrice",
          arguments: { currency: "USD" },
        },
        {
          toolName: "convertCurrency",
          arguments: {
            amount: {
              fromStep: 5,
              outputKey: "price",
            },
          },
        },
      ]);

      expect(() => parsePlanSteps(invalidReference)).toThrow();
    });
  });
});

describe("parseModelOutput", () => {
  it("should parse output with think and plan tags", () => {
    const raw = `
    <think>I need to analyze this request</think>
    <plan>
    [
      {
        "toolName": "searchWeb",
        "arguments": { "query": "test" }
      }
    ]
    </plan>
    `;

    const { think, plan } = parseModelOutput(raw);

    expect(think).toBe("I need to analyze this request");
    expect(plan).toBeDefined();
    expect(plan).toHaveLength(1);
    expect(plan?.[0]?.toolName).toBe("searchWeb");
  });

  it("should parse output with only plan tag", () => {
    const raw = `
    <plan>
    [
      {
        "toolName": "searchWeb",
        "arguments": { "query": "test" }
      }
    ]
    </plan>
    `;

    const { think, plan } = parseModelOutput(raw);

    expect(think).toBeUndefined();
    expect(plan).toBeDefined();
    expect(plan).toHaveLength(1);
  });

  it("should return undefined plan when no plan tag", () => {
    const raw = `
    <think>Just thinking, no plan</think>
    `;

    const { think, plan } = parseModelOutput(raw);

    expect(think).toBe("Just thinking, no plan");
    expect(plan).toBeUndefined();
  });

  it("should handle empty content", () => {
    const raw = "";

    const { think, plan } = parseModelOutput(raw);

    expect(think).toBeUndefined();
    expect(plan).toBeUndefined();
  });
});
