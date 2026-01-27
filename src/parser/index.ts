import { z } from "zod";
import JSON5 from "json5";
import { v4 as uuidv4 } from "uuid";

import { parseTemplateString } from "./template-string-parser";

import {
  type ParamsValue,
  type PlanStep,
  type PlanStepParams,
  type RawDependencyReference,
  type StringTemplateReference,
  PlanStepStatus,
} from "../types";
import { isRawDependencyReference, normalizePath } from "../utils";

const DependencyReferenceSchema = z.object({
  fromStep: z.number(),
  outputKey: z.string(),
});

export const ParamSchema: z.ZodType<ParamsValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ParamSchema),
    DependencyReferenceSchema,
    z.record(z.string(), ParamSchema),
  ]),
);

const ToolStepSchema = z.object({
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  thought: z.string().optional(),
});

const PlanSchema = z.array(ToolStepSchema);

export function parseModelOutput(raw: string) {
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
  const planMatch = raw.match(/<plan>([\s\S]*?)<\/plan>/);

  const think = thinkMatch?.[1] ? thinkMatch[1].trim() : undefined;
  const plan = planMatch?.[1] ? parsePlanSteps(planMatch[1]) : undefined;

  return { think, plan };
}

export function parsePlanSteps(rawSteps: string): PlanStep[] {
  const parsedRawSteps = parseJsonCodeBlock(rawSteps);

  const rawPlan = PlanSchema.safeParse(parsedRawSteps);

  if (!rawPlan.success) {
    console.error(`Invalid plan: ${rawPlan.error.message}`, {
      rawPlan,
      rawSteps,
    });

    throw new Error(`invalid json parsing: ${rawPlan.error.message}`);
  }

  const stepIdByIndex = new Map<number, string>();

  const rawPlanWithIds = rawPlan.data.map((step, index) => {
    const stepId = uuidv4();
    stepIdByIndex.set(index, stepId);

    return {
      stepId,
      ...step,
    };
  });

  return rawPlanWithIds.map((step) => ({
    stepId: step.stepId,
    status: PlanStepStatus.Pending,
    toolName: step.toolName,
    arguments: transformParams(step.arguments, stepIdByIndex),
    thought: step.thought,
  }));
}

function parseJsonCodeBlock(codeBlock: string): unknown {
  const trimmed = codeBlock.trim();
  const starts = ["{", "["]
    .map((c) => trimmed.indexOf(c))
    .filter((i) => i !== -1);
  const ends = ["}", "]"]
    .map((c) => trimmed.lastIndexOf(c))
    .filter((i) => i !== -1);

  if (starts.length === 0 || ends.length === 0) {
    throw new Error("invalid json parsing: no JSON object or array found");
  }

  const start = Math.min(...starts);
  const end = Math.max(...ends);

  if (end < start) {
    throw new Error("invalid json parsing: malformed JSON boundaries");
  }

  const jsonSubstring = trimmed.slice(start, end + 1);

  try {
    return JSON5.parse(jsonSubstring);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`invalid json parsing: ${error.message}`, { codeBlock });
      throw new Error(`invalid json parsing: ${error.message}`);
    }

    throw new Error("invalid json parsing");
  }
}

function transformParams(
  params: Record<string, unknown>,
  stepIdByIndex: Map<number, string>,
): PlanStepParams {
  const transformedParams: Record<string, ParamsValue> = {};

  for (const [key, value] of Object.entries(params)) {
    transformedParams[key] = transformParamsValue(value, stepIdByIndex);
  }

  return transformedParams;
}

function transformParamsValue(
  value: unknown,
  stepIdByIndex: Map<number, string>,
): ParamsValue {
  if (Array.isArray(value)) {
    return value.map((v) => transformParamsValue(v, stepIdByIndex));
  }

  if (typeof value === "string") {
    const spec = parseTemplateString(value, stepIdByIndex);

    if (typeof spec !== "string") {
      return spec as StringTemplateReference;
    }

    return spec;
  }

  if (isRawDependencyReference(value)) {
    const ref = value as RawDependencyReference;
    const stepId = stepIdByIndex.get(ref.fromStep);

    if (!stepId) {
      console.error(
        `Invalid dependency reference: step ${ref.fromStep} not found`,
        { dependencyReference: value },
      );

      throw new Error(
        `Invalid dependency reference: step ${ref.fromStep} not found`,
      );
    }

    return { $fromStep: stepId, $outputKey: normalizePath(ref.outputKey) };
  }

  if (typeof value === "object" && value !== null) {
    const obj: Record<string, ParamsValue> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = transformParamsValue(v, stepIdByIndex);
    }

    return obj;
  }

  return value as ParamsValue;
}
