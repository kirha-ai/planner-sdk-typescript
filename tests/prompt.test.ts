import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompt";
import type { Tool } from "../src/types";

const tool: Tool = {
  name: "getWalletBalance",
  description: "Get native token balance of a wallet",
  inputSchema: JSON.stringify({
    type: "object",
    properties: {
      address: { type: "string" },
      chain: { type: "string", enum: ["ethereum", "solana"] },
      context: { type: "string" },
    },
    required: ["address"],
    additionalProperties: false,
  }),
  outputSchema: JSON.stringify({
    type: "object",
    properties: {
      context: { type: "string" },
      balance: { type: "string" },
      tokens: {
        type: "array",
        items: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
      },
    },
    required: ["balance"],
  }),
  handler: async () => ({}),
};

describe("buildSystemPrompt", () => {
  it("serializes tools in the training format", () => {
    expect(buildSystemPrompt([tool])).toBe(
      `<tools>[{name:'getWalletBalance',description:'Get native token balance of a wallet',input:{address:'string',chain:{type:'string',enum:['ethereum','solana']}},output:{context:'string',balance:'string',tokens:{type:'array',items:{type:'object',properties:{symbol:'string'}}}}}]</tools>`,
    );
  });

  it("prepends instructions when provided", () => {
    expect(buildSystemPrompt([], "Be concise")).toBe(
      "Be concise\n<tools>[]</tools>",
    );
  });

  it("keeps non-object schemas untouched", () => {
    const scalar: Tool = {
      ...tool,
      inputSchema: '{"type":"string"}',
      outputSchema: "not json",
    };

    expect(buildSystemPrompt([scalar])).toContain("input:'string',output:{}");
  });
});
