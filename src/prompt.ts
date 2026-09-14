import json5 from "json5";
import type { Tool } from "./types";

type JsonSchema = Record<string, unknown>;

const STRIPPED_KEYS = new Set(["additionalProperties", "required"]);

export function buildSystemPrompt(
  tools: Tool[],
  instructions?: string,
): string {
  const compressed = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input: compressSchema(parseSchema(tool.inputSchema), true),
    output: compressSchema(parseSchema(tool.outputSchema), false),
  }));

  const toolsBlock = `<tools>${json5.stringify(compressed)}</tools>`;

  return instructions ? `${instructions}\n${toolsBlock}` : toolsBlock;
}

function parseSchema(schema: string): JsonSchema {
  try {
    return json5.parse(schema);
  } catch {
    return {};
  }
}

export function compressSchema(
  schema: JsonSchema,
  stripContextField: boolean,
): unknown {
  const compressed = compress(schema);

  if (
    typeof compressed !== "object" ||
    compressed === null ||
    Array.isArray(compressed)
  ) {
    return compressed;
  }

  const properties = (compressed as JsonSchema).properties as
    | JsonSchema
    | undefined;

  if ((compressed as JsonSchema).type !== "object" || !properties) {
    return compressed;
  }

  if (stripContextField) {
    delete properties.context;
  }

  return properties;
}

function compress(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compress);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value);

  if (
    entries.length === 1 &&
    entries[0]?.[0] === "type" &&
    typeof entries[0][1] === "string"
  ) {
    return entries[0][1];
  }

  const result: JsonSchema = {};

  for (const [key, val] of entries) {
    if (!STRIPPED_KEYS.has(key)) {
      result[key] = compress(val);
    }
  }

  return result;
}
