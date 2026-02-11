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

interface ErrorContext {
  stepId: string;
  toolName: string;
  argumentPath: string;
  fromStepId?: string;
  outputPath?: string;
}

function createErrorContext(
  step: PlanStep,
  argumentPath: Path,
  reference?: DependencyReference,
): ErrorContext {
  return {
    stepId: step.stepId,
    toolName: step.toolName,
    argumentPath: formatPath(argumentPath),
    ...(reference && {
      fromStepId: reference.$fromStep,
      outputPath: reference.$outputKey,
    }),
  };
}

function createValidationError(
  code: PlanValidationError["code"],
  message: string,
  context: ErrorContext,
  extra?: { expectedType?: string; actualType?: string },
): PlanValidationError {
  return {
    code,
    message,
    ...context,
    ...extra,
  };
}

export function isValidPlan(
  steps: PlanStep[],
  tools: Tool[],
): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const schemasByTool = new Map<string, ToolSchemas>();
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));

  for (const tool of tools) {
    const { schemas, errorDetail } = parseToolSchemas(tool);
    if (schemas) {
      schemasByTool.set(tool.name, schemas);
    } else {
      const detail = errorDetail ? `: ${errorDetail}` : "";
      errors.push({
        code: "schema_parse_error",
        message: `Failed to parse input/output schema for tool "${tool.name}"${detail}`,
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
      onDependency: (ref, path) => {
        validateDependencyReference({
          reference: ref,
          argumentPath: path,
          step,
          inputSchema: schemas.input,
          stepsById,
          schemasByTool,
          errors,
        });
      },
      onTemplate: (ref, path) => {
        validateStringTemplateReference({
          reference: ref,
          argumentPath: path,
          step,
          inputSchema: schemas.input,
          stepsById,
          schemasByTool,
          errors,
        });
      },
    });
  }

  return { valid: errors.length === 0, errors };
}

interface ParseToolSchemasResult {
  schemas: ToolSchemas | null;
  errorDetail?: string;
}

function parseToolSchemas(tool: Tool): ParseToolSchemasResult {
  try {
    const input = parseSchema(tool.inputSchema);
    const output = parseSchema(tool.outputSchema);
    return { schemas: { input, output } };
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    return { schemas: null, errorDetail };
  }
}

function parseSchema(rawSchema: string): z.ZodTypeAny {
  try {
    return z.fromJSONSchema(JSON5.parse(rawSchema));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON schema: ${message}`);
  }
}

function getExpectedSchemaOrError(
  inputSchema: z.ZodTypeAny,
  argumentPath: Path,
  step: PlanStep,
  reference: DependencyReference | undefined,
  errors: PlanValidationError[],
): z.ZodTypeAny | null {
  const expectedSchema = getSchemaAtPath(inputSchema, argumentPath);

  if (!expectedSchema) {
    const context = createErrorContext(step, argumentPath, reference);
    errors.push(
      createValidationError(
        "input_key_missing",
        `Input path "${context.argumentPath}" not found on tool "${step.toolName}"`,
        context,
      ),
    );
    return null;
  }

  return expectedSchema;
}

function validateDependencyReference({
  reference,
  argumentPath,
  step,
  inputSchema,
  stepsById,
  schemasByTool,
  errors,
}: {
  reference: DependencyReference;
  argumentPath: Path;
  step: PlanStep;
  inputSchema: z.ZodTypeAny;
  stepsById: Map<string, PlanStep>;
  schemasByTool: Map<string, ToolSchemas>;
  errors: PlanValidationError[];
}): void {
  const expectedSchema = getExpectedSchemaOrError(
    inputSchema,
    argumentPath,
    step,
    reference,
    errors,
  );

  if (expectedSchema) {
    validateOutputReference({
      reference,
      argumentPath,
      expectedSchema,
      step,
      stepsById,
      schemasByTool,
      errors,
    });
  }
}

function resolveSourceStep(
  reference: DependencyReference,
  stepsById: Map<string, PlanStep>,
  context: ErrorContext,
  errors: PlanValidationError[],
): PlanStep | null {
  const sourceStep = stepsById.get(reference.$fromStep);

  if (!sourceStep) {
    errors.push(
      createValidationError(
        "dependency_step_missing",
        `Step "${reference.$fromStep}" not found`,
        context,
      ),
    );
    return null;
  }

  return sourceStep;
}

function resolveSourceSchemas(
  sourceStep: PlanStep,
  schemasByTool: Map<string, ToolSchemas>,
  context: ErrorContext,
  errors: PlanValidationError[],
): ToolSchemas | null {
  const sourceSchemas = schemasByTool.get(sourceStep.toolName);

  if (!sourceSchemas) {
    errors.push(
      createValidationError(
        "schema_parse_error",
        `Output schema for tool "${sourceStep.toolName}" could not be parsed`,
        context,
      ),
    );
    return null;
  }

  return sourceSchemas;
}

function resolveOutputSchema(
  reference: DependencyReference,
  sourceSchemas: ToolSchemas,
  sourceStep: PlanStep,
  context: ErrorContext,
  errors: PlanValidationError[],
): z.ZodTypeAny | null {
  const outputSchema = getSchemaAtPath(
    sourceSchemas.output,
    parsePath(reference.$outputKey),
  );

  if (!outputSchema) {
    errors.push(
      createValidationError(
        "output_key_missing",
        `Output key "${reference.$outputKey}" not found on tool "${sourceStep.toolName}"`,
        context,
      ),
    );
    return null;
  }

  return outputSchema;
}

function validateOutputReference({
  reference,
  argumentPath,
  expectedSchema,
  step,
  stepsById,
  schemasByTool,
  errors,
}: {
  reference: DependencyReference;
  argumentPath: Path;
  expectedSchema: z.ZodTypeAny;
  step: PlanStep;
  stepsById: Map<string, PlanStep>;
  schemasByTool: Map<string, ToolSchemas>;
  errors: PlanValidationError[];
}): void {
  const context = createErrorContext(step, argumentPath, reference);

  const sourceStep = resolveSourceStep(reference, stepsById, context, errors);
  if (!sourceStep) return;

  const sourceSchemas = resolveSourceSchemas(
    sourceStep,
    schemasByTool,
    context,
    errors,
  );
  if (!sourceSchemas) return;

  const outputSchema = resolveOutputSchema(
    reference,
    sourceSchemas,
    sourceStep,
    context,
    errors,
  );
  if (!outputSchema) return;

  if (!isSchemaCompatible(expectedSchema, outputSchema)) {
    errors.push(
      createValidationError(
        "type_mismatch",
        `Type mismatch for "${context.argumentPath}"`,
        context,
        {
          expectedType: describeSchemaType(expectedSchema),
          actualType: describeSchemaType(outputSchema),
        },
      ),
    );
  }
}

function validateStringTemplateReference({
  reference,
  argumentPath,
  step,
  inputSchema,
  stepsById,
  schemasByTool,
  errors,
}: {
  reference: StringTemplateReference;
  argumentPath: Path;
  step: PlanStep;
  inputSchema: z.ZodTypeAny;
  stepsById: Map<string, PlanStep>;
  schemasByTool: Map<string, ToolSchemas>;
  errors: PlanValidationError[];
}): void {
  const expectedSchema = getExpectedSchemaOrError(
    inputSchema,
    argumentPath,
    step,
    undefined,
    errors,
  );

  if (!expectedSchema) {
    return;
  }

  const context = createErrorContext(step, argumentPath);

  if (!isSchemaCompatible(expectedSchema, z.string())) {
    errors.push(
      createValidationError(
        "type_mismatch",
        `Type mismatch for "${context.argumentPath}"`,
        context,
        {
          expectedType: describeSchemaType(expectedSchema),
          actualType: "string",
        },
      ),
    );
  }

  const stringCoercible = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({}),
    z.array(z.any()),
  ]);

  for (const ref of reference.$values) {
    validateOutputReference({
      reference: ref,
      argumentPath,
      expectedSchema: stringCoercible,
      step,
      stepsById,
      schemasByTool,
      errors,
    });
  }
}

function getSchemaAtPath(
  schema: z.ZodTypeAny,
  path: Array<string | number>,
): z.ZodTypeAny | undefined {
  let current = unwrapSchema(schema);

  for (const [i, segment] of path.entries()) {
    if (typeof segment === "number") {
      if (!(current instanceof z.ZodArray)) {
        return undefined;
      }
      current = unwrapSchema(current.element as z.ZodTypeAny);
      continue;
    }

    if (current instanceof z.ZodArray && isNumericString(segment)) {
      current = unwrapSchema(current.element as z.ZodTypeAny);
      continue;
    }

    if (current instanceof z.ZodUnion || current instanceof z.ZodXor) {
      const remaining = path.slice(i);
      const resolved = (current.options as z.ZodTypeAny[])
        .map((option) => getSchemaAtPath(option, remaining))
        .filter((s): s is z.ZodTypeAny => s !== undefined);

      if (resolved.length === 0) {
        return undefined;
      }

      if (resolved.length === 1) {
        return resolved[0];
      }

      return z.union(
        resolved as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
      );
    }

    if (!(current instanceof z.ZodObject)) {
      return undefined;
    }

    const shape = current.shape as Record<string, z.ZodTypeAny>;
    const child = shape[segment];
    if (!child) {
      return undefined;
    }
    current = unwrapSchema(child);
  }

  return current;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
  ) {
    return unwrapSchema(schema._def.innerType as z.ZodTypeAny);
  }

  return schema;
}

function isSchemaCompatible(
  expected: z.ZodTypeAny,
  actual: z.ZodTypeAny,
): boolean {
  const expectedTypes = getTypeSet(expected);
  const actualTypes = getTypeSet(actual);

  if (expectedTypes.has("any")) {
    return true;
  }

  for (const actualType of actualTypes) {
    if (expectedTypes.has(actualType)) {
      return true;
    }
  }

  return false;
}

const KNOWN_ZOD_TYPES: Array<[new (...args: never[]) => z.ZodTypeAny, string]> =
  [
    [z.ZodAny, "any"],
    [z.ZodString, "string"],
    [z.ZodNumber, "number"],
    [z.ZodBoolean, "boolean"],
    [z.ZodNull, "null"],
    [z.ZodArray, "array"],
    [z.ZodObject, "object"],
  ];

function getTypeSet(schema: z.ZodTypeAny): Set<string> {
  const unwrapped = unwrapSchema(schema);

  for (const [ZodClass, typeName] of KNOWN_ZOD_TYPES) {
    if (unwrapped instanceof ZodClass) {
      return new Set([typeName]);
    }
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
