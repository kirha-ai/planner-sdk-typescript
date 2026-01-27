import { describe, expect, it, spyOn } from "bun:test";
import { Planner, Plan, LATEST_MODEL_NAME } from "../src/index";
import type { Tool } from "../src/types";
import type { ChatCompletion } from "openai/resources/chat/completions";

const mockTools: Tool[] = [
  {
    name: "getWeather",
    description: "Get weather for a location",
    inputSchema:
      '{"type":"object","properties":{"location":{"type":"string"}}}',
    outputSchema:
      '{"type":"object","properties":{"temperature":{"type":"number"}}}',
    handler: async (args) => ({
      temperature: 20,
      location: (args as { location: string }).location,
    }),
  },
  {
    name: "sendEmail",
    description: "Send an email",
    inputSchema:
      '{"type":"object","properties":{"to":{"type":"string"},"body":{"type":"string"}}}',
    outputSchema: '{"type":"object","properties":{"sent":{"type":"boolean"}}}',
    handler: async () => ({ sent: true }),
  },
];

describe("Planner", () => {
  it("should create a planner with default model", () => {
    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });
    expect(planner).toBeDefined();
  });

  it("should create a planner with custom model", () => {
    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
      model: "custom-model",
    });
    expect(planner).toBeDefined();
  });

  it("should generate a plan from model response", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: `
<think>I need to get the weather first, then send an email with the result</think>
<plan>
[
  {
    "toolName": "getWeather",
    "thought": "Getting weather for Paris",
    "arguments": { "location": "Paris" }
  },
  {
    "toolName": "sendEmail",
    "thought": "Sending weather report",
    "arguments": {
      "to": "user@example.com",
      "body": "The weather in {0.location} is {0.temperature}°C"
    }
  }
]
</plan>
`,
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    const openaiMock = spyOn(
      planner.openai.chat.completions,
      "create",
    ).mockResolvedValue(mockResponse as ChatCompletion);

    const plan = await planner.generatePlan(
      "What's the weather in Paris? Send me an email about it.",
      {
        tools: mockTools,
      },
    );

    expect(openaiMock).toHaveBeenCalledTimes(1);
    expect(plan).toBeDefined();
    expect(plan).toBeInstanceOf(Plan);
  });

  it("should pass correct parameters to OpenAI", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: "<plan>[]</plan>",
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
      model: "custom-model",
    });

    const openaiMock = spyOn(
      planner.openai.chat.completions,
      "create",
    ).mockResolvedValue(mockResponse as ChatCompletion);

    await planner.generatePlan("Test query", {
      tools: mockTools,
      instructions: "Be concise",
      temperature: 0.5,
      maxTokens: 5000,
    });

    expect(openaiMock).toHaveBeenCalledWith({
      model: "custom-model",
      messages: [
        {
          role: "system",
          content: expect.stringContaining("# Instructions\nBe concise"),
        },
        { role: "user", content: "Test query" },
      ],
      temperature: 0.5,
      max_tokens: 5000,
    });
  });

  it("should throw error when no response from model", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    spyOn(planner.openai.chat.completions, "create").mockResolvedValue(
      mockResponse as ChatCompletion,
    );

    await expect(
      planner.generatePlan("Test", { tools: mockTools }),
    ).rejects.toThrow("No response from model");
  });

  it("should throw error when no content in response", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    spyOn(planner.openai.chat.completions, "create").mockResolvedValue(
      mockResponse as ChatCompletion,
    );

    await expect(
      planner.generatePlan("Test", { tools: mockTools }),
    ).rejects.toThrow("No plan generated");
  });

  it("should return undefined when response has no plan tag", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: "<think>I don't know how to do this</think>",
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    spyOn(planner.openai.chat.completions, "create").mockResolvedValue(
      mockResponse as ChatCompletion,
    );

    const plan = await planner.generatePlan("Do something impossible", {
      tools: mockTools,
    });

    expect(plan).toBeUndefined();
  });
});

describe("Plan", () => {
  it("should execute steps with tools", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: `
<plan>
[
  {
    "toolName": "getWeather",
    "arguments": { "location": "London" }
  }
]
</plan>
`,
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    spyOn(planner.openai.chat.completions, "create").mockResolvedValue(
      mockResponse as ChatCompletion,
    );

    const plan = await planner.generatePlan("Weather in London", {
      tools: mockTools,
    });

    expect(plan).toBeDefined();

    const results = await plan?.execute({ tools: mockTools });

    expect(results).toHaveLength(1);
    expect(results?.[0]?.output).toEqual({
      temperature: 20,
      location: "London",
    });
    expect(results?.[0]?.error).toBeUndefined();
  });

  it("should execute multi-step plan with dependencies", async () => {
    const mockResponse: Partial<ChatCompletion> = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: `
<plan>
[
  {
    "toolName": "getWeather",
    "arguments": { "location": "Tokyo" }
  },
  {
    "toolName": "sendEmail",
    "arguments": {
      "to": "user@test.com",
      "body": {
        "fromStep": 0,
        "outputKey": "temperature"
      }
    }
  }
]
</plan>
`,
            refusal: null,
          },
        },
      ],
    };

    const planner = new Planner("https://api.example.com", {
      apiKey: "test-key",
    });

    spyOn(planner.openai.chat.completions, "create").mockResolvedValue(
      mockResponse as ChatCompletion,
    );

    const plan = await planner.generatePlan("Weather in Tokyo and email it", {
      tools: mockTools,
    });

    const results = await plan?.execute({ tools: mockTools });

    expect(results).toHaveLength(2);
    expect(results?.[0]?.output).toEqual({
      temperature: 20,
      location: "Tokyo",
    });
    expect(results?.[1]?.output).toEqual({ sent: true });
    expect(results?.[1]?.arguments.body).toBe(20);
  });
});

describe("LATEST_MODEL_NAME", () => {
  it("should be defined", () => {
    expect(LATEST_MODEL_NAME).toBe("kirha/planner");
  });
});
