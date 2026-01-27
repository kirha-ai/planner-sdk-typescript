// Tool types
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  args: TInput,
) => Promise<TOutput>;

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  handler: ToolHandler<TInput, TOutput>;
}

export interface StepResult {
  stepId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  output: unknown;
  error?: string;
}

export type PlanValidationErrorCode =
  | "tool_not_found"
  | "schema_parse_error"
  | "dependency_step_missing"
  | "input_key_missing"
  | "output_key_missing"
  | "type_mismatch";

export interface PlanValidationError {
  code: PlanValidationErrorCode;
  message: string;
  stepId?: string;
  toolName?: string;
  argumentPath?: string;
  fromStepId?: string;
  outputPath?: string;
  expectedType?: string;
  actualType?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationError[];
}

// Plan types
export interface DependencyReference {
  $fromStep: string;
  $outputKey: string;
}

export interface StringTemplateReference {
  $fromTemplateString: string;
  $values: DependencyReference[];
}

export interface RawDependencyReference {
  fromStep: number;
  outputKey: string;
}

export type ParamsValue =
  | string
  | number
  | boolean
  | null
  | ParamObject
  | DependencyReference
  | StringTemplateReference
  | Array<ParamsValue | DependencyReference>;

interface ParamObject {
  [key: string]: ParamsValue;
}

export type PlanStepParams = Record<string, ParamsValue>;

export enum PlanStepStatus {
  Pending = "pending",
  Executing = "executing",
  Done = "done",
  Failed = "failed",
  Skipped = "skipped",
  Timeout = "timeout",
}

export interface PlanStep {
  stepId: string;
  status: PlanStepStatus;
  toolName: string;
  arguments: PlanStepParams;
  thought?: string;
}
