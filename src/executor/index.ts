import {
  type PlanStep,
  type Tool,
  type StepResult,
  PlanStepStatus,
} from "../types";
import {
  extractDependencyStepIds,
  getNestedValue,
  isDependencyReference,
  isStringTemplateReference,
  parsePath,
} from "../utils";

export interface ExecuteOptions {
  tools: Tool[];
}

export async function executePlan(
  steps: PlanStep[],
  options: ExecuteOptions,
): Promise<StepResult[]> {
  const toolsByName = new Map(options.tools.map((t) => [t.name, t]));
  const results: StepResult[] = [];
  const outputsByStepId = new Map<string, unknown>();
  const statusByStepId = new Map<string, PlanStepStatus>(
    steps.map((s) => [s.stepId, PlanStepStatus.Pending]),
  );

  const tryExecuteStep = async (step: PlanStep): Promise<void> => {
    const tool = toolsByName.get(step.toolName);

    if (!tool) {
      statusByStepId.set(step.stepId, PlanStepStatus.Skipped);

      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        arguments: {},
        output: null,
        error: `Tool "${step.toolName}" not found`,
      });

      return;
    }

    let resolvedArgs: Record<string, unknown>;

    try {
      resolvedArgs = resolveArguments(step.arguments, outputsByStepId);
    } catch (error) {
      statusByStepId.set(step.stepId, PlanStepStatus.Skipped);

      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        arguments: {},
        output: null,
        error: `Failed to resolve arguments: ${error instanceof Error ? error.message : String(error)}`,
      });

      return;
    }

    statusByStepId.set(step.stepId, PlanStepStatus.Executing);

    try {
      const output = await tool.handler(resolvedArgs);

      outputsByStepId.set(step.stepId, output);
      statusByStepId.set(step.stepId, PlanStepStatus.Done);

      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        arguments: resolvedArgs,
        output,
      });
    } catch (error) {
      statusByStepId.set(step.stepId, PlanStepStatus.Failed);

      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        arguments: resolvedArgs,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const getReadySteps = (): PlanStep[] => {
    return steps.filter((step) => {
      if (statusByStepId.get(step.stepId) !== PlanStepStatus.Pending) {
        return false;
      }

      const deps = extractDependencyStepIds(step.arguments);
      return deps.every(
        (depStepId) => statusByStepId.get(depStepId) === PlanStepStatus.Done,
      );
    });
  };

  let readySteps = getReadySteps();
  while (readySteps.length > 0) {
    await Promise.all(readySteps.map(tryExecuteStep));
    readySteps = getReadySteps();
  }

  for (const step of steps) {
    if (statusByStepId.get(step.stepId) === PlanStepStatus.Pending) {
      statusByStepId.set(step.stepId, PlanStepStatus.Skipped);
      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        arguments: step.arguments,
        output: null,
        error: "Skipped: dependencies not satisfied",
      });
    }
  }

  const stepOrder = new Map(steps.map((s, i) => [s.stepId, i]));
  results.sort(
    (a, b) => (stepOrder.get(a.stepId) ?? 0) - (stepOrder.get(b.stepId) ?? 0),
  );

  return results;
}

export function resolveArguments(
  args: Record<string, unknown>,
  outputsByStepId: Map<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    resolved[key] = resolveValue(value, outputsByStepId);
  }

  return resolved;
}

export function resolveValue(
  value: unknown,
  outputsByStepId: Map<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, outputsByStepId));
  }

  if (isDependencyReference(value)) {
    const stepOutput = outputsByStepId.get(value.$fromStep);

    if (stepOutput === undefined) {
      throw new Error(`Step ${value.$fromStep} output not found`);
    }

    return getNestedValue(stepOutput, parsePath(value.$outputKey));
  }

  if (isStringTemplateReference(value)) {
    let result = value.$fromTemplateString;

    for (const [i, ref] of value.$values.entries()) {
      const stepOutput = outputsByStepId.get(ref.$fromStep);
      const resolvedValue = getNestedValue(
        stepOutput,
        parsePath(ref.$outputKey),
      );
      result = result.replace(`{${i}}`, String(resolvedValue));
    }

    return result;
  }

  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveValue(v, outputsByStepId);
    }
    return resolved;
  }

  return value;
}
