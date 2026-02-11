import JSON5 from "json5";
import { z } from "zod";

import type {
  DependencyReference,
  PlanStep,
  PlanValidationError,
  PlanValidationResult,
  StringTemplateReference,
  Tool,
} from "../types";
import {
  formatPath,
  isNumericString,
  parsePath,
  traverseReferences,
  type Path,
} from "../utils";

type ToolSchemas = { input: z.ZodTypeAny; output: z.ZodTypeAny };

export function isValidPlan(
  steps: PlanStep[],
  tools: Tool[],
): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const schemasByTool = new Map<string, ToolSchemas>();
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));

  for (const tool of tools) {
    try {
      schemasByTool.set(tool.name, {
        input: parseSchema(tool.inputSchema),
        output: parseSchema(tool.outputSchema),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push({
        code: "schema_parse_error",
        message: `Failed to parse input/output schema for tool "${tool.name}": ${detail}`,
        toolName: tool.name,
      });
    }
  }

  for (const step of steps) {
    const tool = toolsByName.get(step.toolName);

    if (!tool) {
      errors.push({
        code: "tool_not_found",
        message: `Tool "${step.toolName}" not found`,
        stepId: step.stepId,
        toolName: step.toolName,
      });
      continue;
    }

    const schemas = schemasByTool.get(tool.name);

    if (!schemas) {
      errors.push({
        code: "schema_parse_error",
        message: `Schemas for tool "${tool.name}" could not be parsed`,
        stepId: step.stepId,
        toolName: tool.name,
      });
      continue;
    }

    traverseReferences(step.arguments, {
      onDependency: (ref, inputPath) => {
        const formattedInputPath = formatPath(inputPath);
        const expectedSchema = getSchemaAtPath(schemas.input, inputPath);

        if (!expectedSchema) {
          errors.push({
            code: "input_key_missing",
            message: `Input path "${formattedInputPath}" not found on tool "${step.toolName}"`,
            stepId: step.stepId,
            toolName: step.toolName,
            argumentPath: formattedInputPath,
            fromStepId: ref.$fromStep,
            outputPath: ref.$outputKey,
          });
          return;
        }

        validateOutputReference(
          ref,
          formattedInputPath,
          expectedSchema,
          step,
          stepsById,
          schemasByTool,
          errors,
        );
      },
      onTemplate: (ref, inputPath) => {
        validateStringTemplateReference(
          ref,
          inputPath,
          step,
          schemas.input,
          stepsById,
          schemasByTool,
          errors,
        );
      },
    });
  }

  return { valid: errors.length === 0, errors };
}

function parseSchema(rawSchema: string): z.ZodTypeAny {
  try {
    return z.fromJSONSchema(JSON5.parse(rawSchema));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON schema: ${message}`);
  }
}

function validateOutputReference(
  reference: DependencyReference,
  inputPath: string,
  expectedSchema: z.ZodTypeAny,
  step: PlanStep,
  stepsById: Map<string, PlanStep>,
  schemasByTool: Map<string, ToolSchemas>,
  errors: PlanValidationError[],
): void {
  const baseContext = {
    stepId: step.stepId,
    toolName: step.toolName,
    argumentPath: inputPath,
    fromStepId: reference.$fromStep,
    outputPath: reference.$outputKey,
  };

  const sourceStep = stepsById.get(reference.$fromStep);
  if (!sourceStep) {
    errors.push({
      code: "dependency_step_missing",
      message: `Step "${reference.$fromStep}" not found`,
      ...baseContext,
    });
    return;
  }

  const sourceSchemas = schemasByTool.get(sourceStep.toolName);
  if (!sourceSchemas) {
    errors.push({
      code: "schema_parse_error",
      message: `Output schema for tool "${sourceStep.toolName}" could not be parsed`,
      ...baseContext,
    });
    return;
  }

  const outputSchema = getSchemaAtPath(
    sourceSchemas.output,
    parsePath(reference.$outputKey),
  );
  if (!outputSchema) {
    errors.push({
      code: "output_key_missing",
      message: `Output key "${reference.$outputKey}" not found on tool "${sourceStep.toolName}"`,
      ...baseContext,
    });
    return;
  }

  if (!isSchemaCompatible(expectedSchema, outputSchema)) {
    errors.push({
      code: "type_mismatch",
      message: `Type mismatch for "${inputPath}"`,
      ...baseContext,
      expectedType: describeSchemaType(expectedSchema),
      actualType: describeSchemaType(outputSchema),
    });
  }
}

function validateStringTemplateReference(
  reference: StringTemplateReference,
  inputPath: Path,
  step: PlanStep,
  inputSchema: z.ZodTypeAny,
  stepsById: Map<string, PlanStep>,
  schemasByTool: Map<string, ToolSchemas>,
  errors: PlanValidationError[],
): void {
  const formattedInputPath = formatPath(inputPath);
  const expectedSchema = getSchemaAtPath(inputSchema, inputPath);

  if (!expectedSchema) {
    errors.push({
      code: "input_key_missing",
      message: `Input path "${formattedInputPath}" not found on tool "${step.toolName}"`,
      stepId: step.stepId,
      toolName: step.toolName,
      argumentPath: formattedInputPath,
    });
    return;
  }

  if (!isSchemaCompatible(expectedSchema, z.string())) {
    errors.push({
      code: "type_mismatch",
      message: `Type mismatch for "${formattedInputPath}"`,
      stepId: step.stepId,
      toolName: step.toolName,
      argumentPath: formattedInputPath,
      expectedType: describeSchemaType(expectedSchema),
      actualType: "string",
    });
  }

  const stringCoercible = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({}),
    z.array(z.any()),
  ]);

  for (const ref of reference.$values) {
    validateOutputReference(
      ref,
      formattedInputPath,
      stringCoercible,
      step,
      stepsById,
      schemasByTool,
      errors,
    );
  }
}

function getSchemaAtPath(
  schema: z.ZodTypeAny,
  path: Array<string | number>,
): z.ZodTypeAny | undefined {
  const unwrapped = unwrapSchema(schema);

  if (path.length === 0) {
    return unwrapped;
  }

  if (unwrapped instanceof z.ZodUnion || unwrapped instanceof z.ZodXor) {
    const resolvedOptions = (unwrapped.options as z.ZodTypeAny[])
      .map((option) => getSchemaAtPath(option, path))
      .filter((resolved): resolved is z.ZodTypeAny => resolved !== undefined);

    if (resolvedOptions.length === 0) {
      return undefined;
    }

    if (resolvedOptions.length === 1) {
      return resolvedOptions[0];
    }

    return z.union(
      resolvedOptions as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
    );
  }

  const segment = path[0];
  if (segment === undefined) {
    return unwrapped;
  }

  const remainingPath = path.slice(1);

  if (typeof segment === "number") {
    if (!(unwrapped instanceof z.ZodArray)) {
      return undefined;
    }

    return getSchemaAtPath(unwrapped.element as z.ZodTypeAny, remainingPath);
  }

  if (unwrapped instanceof z.ZodArray && isNumericString(segment)) {
    return getSchemaAtPath(unwrapped.element as z.ZodTypeAny, remainingPath);
  }

  if (!(unwrapped instanceof z.ZodObject)) {
    return undefined;
  }

  const childSchema = getObjectChildSchema(unwrapped, segment);

  if (!childSchema) {
    return undefined;
  }

  return getSchemaAtPath(childSchema, remainingPath);
}

function getObjectChildSchema(
  schema: z.ZodObject,
  segment: string,
): z.ZodTypeAny | undefined {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const direct = shape[segment];
  if (direct) {
    return direct;
  }

  const catchall = schema.def.catchall as z.ZodTypeAny | undefined;

  if (
    catchall &&
    !(catchall instanceof z.ZodUnknown) &&
    !(catchall instanceof z.ZodAny) &&
    !(catchall instanceof z.ZodNever)
  ) {
    return catchall;
  }

  if (Object.keys(shape).length === 0) {
    return z.any();
  }

  return undefined;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
  ) {
    return unwrapSchema(schema.def.innerType as z.ZodTypeAny);
  }

  return schema;
}

function isSchemaCompatible(
  expected: z.ZodTypeAny,
  actual: z.ZodTypeAny,
): boolean {
  const expectedUnwrapped = unwrapSchema(expected);
  const actualUnwrapped = unwrapSchema(actual);

  if (
    expectedUnwrapped instanceof z.ZodAny ||
    actualUnwrapped instanceof z.ZodAny
  ) {
    return true;
  }

  if (
    expectedUnwrapped instanceof z.ZodUnion ||
    expectedUnwrapped instanceof z.ZodXor
  ) {
    return (expectedUnwrapped.options as z.ZodTypeAny[]).some((option) =>
      isSchemaCompatible(option, actualUnwrapped),
    );
  }

  if (
    actualUnwrapped instanceof z.ZodUnion ||
    actualUnwrapped instanceof z.ZodXor
  ) {
    return (actualUnwrapped.options as z.ZodTypeAny[]).some((option) =>
      isSchemaCompatible(expectedUnwrapped, option),
    );
  }

  if (
    expectedUnwrapped instanceof z.ZodArray &&
    actualUnwrapped instanceof z.ZodArray
  ) {
    return isSchemaCompatible(
      expectedUnwrapped.element as z.ZodTypeAny,
      actualUnwrapped.element as z.ZodTypeAny,
    );
  }

  if (
    expectedUnwrapped instanceof z.ZodObject &&
    actualUnwrapped instanceof z.ZodObject
  ) {
    const expectedShape = expectedUnwrapped.shape as Record<
      string,
      z.ZodTypeAny
    >;
    const actualShape = actualUnwrapped.shape as Record<string, z.ZodTypeAny>;

    for (const [key, expectedFieldSchema] of Object.entries(expectedShape)) {
      if (isOptionalField(expectedFieldSchema)) {
        continue;
      }

      const actualFieldSchema = actualShape[key];
      if (!actualFieldSchema) {
        return false;
      }

      if (!isSchemaCompatible(expectedFieldSchema, actualFieldSchema)) {
        return false;
      }
    }

    for (const [key, actualFieldSchema] of Object.entries(actualShape)) {
      const expectedFieldSchema = expectedShape[key];
      if (!expectedFieldSchema) {
        continue;
      }

      if (!isSchemaCompatible(expectedFieldSchema, actualFieldSchema)) {
        return false;
      }
    }

    return true;
  }

  const expectedTypes = getTypeSet(expected);
  const actualTypes = getTypeSet(actual);

  if (expectedTypes.has("any") || actualTypes.has("unknown")) {
    return true;
  }

  for (const actualType of actualTypes) {
    if (expectedTypes.has(actualType)) {
      return true;
    }
  }

  return false;
}

function isOptionalField(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}

const KNOWN_ZOD_TYPES: Array<[new (...args: never[]) => z.ZodTypeAny, string]> =
  [
    [z.ZodAny, "any"],
    [z.ZodUnknown, "any"],
    [z.ZodString, "string"],
    [z.ZodNumber, "number"],
    [z.ZodBoolean, "boolean"],
    [z.ZodNull, "null"],
    [z.ZodArray, "array"],
    [z.ZodTuple, "array"],
    [z.ZodObject, "object"],
    [z.ZodEnum, "string"],
  ];

const LITERAL_TYPE_MAP: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function getTypeSet(schema: z.ZodTypeAny): Set<string> {
  const unwrapped = unwrapSchema(schema);

  for (const [ZodClass, typeName] of KNOWN_ZOD_TYPES) {
    if (unwrapped instanceof ZodClass) {
      return new Set([typeName]);
    }
  }

  if (unwrapped instanceof z.ZodLiteral) {
    const type = LITERAL_TYPE_MAP[typeof unwrapped.value];
    return new Set([type ?? "unknown"]);
  }

  if (unwrapped instanceof z.ZodUnion || unwrapped instanceof z.ZodXor) {
    const types = new Set<string>();
    for (const option of unwrapped.options as z.ZodTypeAny[]) {
      for (const type of getTypeSet(option)) {
        types.add(type);
      }
    }
    return types;
  }

  return new Set(["unknown"]);
}

function describeSchemaType(schema: z.ZodTypeAny): string {
  return [...getTypeSet(schema)].sort().join(" | ");
}
