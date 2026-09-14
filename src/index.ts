import OpenAI from "openai";
import { parseModelOutput, parsePlanSteps } from "./parser";
import { executePlan, type ExecuteOptions } from "./executor";
import { buildSystemPrompt } from "./prompt";
import type { PlanStep, Tool, StepResult } from "./types";

type ReasoningMessage = { reasoning_content?: string; reasoning?: string };

export type {
  Tool,
  ToolHandler,
  StepResult,
  PlanValidationError,
  PlanValidationResult,
} from "./types";

export type { ExecuteOptions } from "./executor";

export { isValidPlan } from "./validator";

export { parsePlanSteps, parseModelOutput };
export { buildSystemPrompt };

export const LATEST_MODEL_NAME = "kirha/planner";

export interface PlanOptions {
  tools: Tool[];
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
}

export class Plan {
  constructor(
    public steps: PlanStep[],
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: not used for the moment, but useful for logs
    public think?: string,
  ) {}

  public async execute(options: ExecuteOptions): Promise<StepResult[]> {
    return executePlan(this.steps, options);
  }
}

export class Planner {
  public openai: OpenAI;
  private model: string;

  constructor(
    baseUrl: string,
    {
      apiKey,
      model = LATEST_MODEL_NAME,
    }: {
      apiKey?: string;
      model?: string;
    },
  ) {
    this.openai = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey ?? "",
    });

    this.model = model;
  }

  public async generatePlan(
    query: string,
    options: PlanOptions,
  ): Promise<Plan | undefined> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(options.tools, options.instructions),
        },
        { role: "user", content: query },
      ],
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 10_000,
    });

    const choice = response.choices?.[0];

    if (!choice) {
      throw new Error("No response from model");
    }

    const rawResponse = choice.message.content;

    if (!rawResponse) {
      throw new Error("No plan generated");
    }

    const message = choice.message as ReasoningMessage;
    const reasoning = message.reasoning_content ?? message.reasoning;
    const { think, plan } = parseModelOutput(rawResponse);

    return plan ? new Plan(plan, think ?? reasoning?.trim()) : undefined;
  }
}
