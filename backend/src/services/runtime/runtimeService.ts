import type { Repositories } from "../../db/repositories.js";
import type { ModelGatewayAdapter, SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { SDKRuntimeContext, Workflow } from "../../schemas/domain.js";
import { AppError, NotFoundError } from "../../utils/errors.js";
import { z } from "zod";

const runtimeIntentSchema = z.object({
  type: z.enum(["workflow_request", "product_question", "navigation_help", "cancel", "pause", "resume", "unknown"]),
  query: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

type RuntimeIntent = z.infer<typeof runtimeIntentSchema>;

export class RuntimeService {
  constructor(
    private readonly repositories: Repositories,
    private readonly gateway: ModelGatewayAdapter,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {}

  async resolve(input: {
    appId: string;
    sessionId: string;
    utterance: string;
    context: Omit<SDKRuntimeContext, "appId" | "sessionId">;
    includeTts?: boolean;
  }) {
    const intentResult = await this.gateway.generateJson<RuntimeIntent>({
      schemaName: "RuntimeIntent",
      prompt: `You are an intent classifier for an in-product SaaS onboarding agent.

Classify the user request into one of:
- workflow_request
- product_question
- navigation_help
- cancel
- pause
- resume
- unknown

Return JSON only:
{
  "type": "...",
  "query": "...",
  "confidence": 0.0
}

User utterance:
${input.utterance}

Current route:
${input.context.currentRoute}`
    });

    const intent = runtimeIntentSchema.parse(intentResult.data);

    if (intent.type === "product_question" || intent.type === "navigation_help") {
      const answer = await this.gateway.generateText({
        prompt: `Answer this product onboarding question briefly using only general product guidance. Do not create UI actions or selectors.

Question: ${intent.query ?? input.utterance}
Current route: ${input.context.currentRoute}`
      });
      return { type: "answer", message: answer.text };
    }

    if (intent.type !== "workflow_request") {
      const message = intent.type === "cancel" ? "Okay, I stopped the current request." : "I could not find a saved workflow for that yet.";
      return { type: "no_match", message };
    }

    const matches = await this.semanticSearch.search({
      query: `${intent.query ?? input.utterance}\nCurrent route: ${input.context.currentRoute}`,
      filters: { kind: "workflow", appId: input.appId, status: "published" },
      limit: 5
    });

    const workflow = this.findExecutableWorkflow(matches, input.appId);
    if (!workflow) {
      const message = "I could not find a saved workflow for that yet.";
      return { type: "no_match", message };
    }

    const message = `I can help you with ${workflow.name}. Let's start.`;
    return {
      type: "workflow",
      workflow: sanitizeWorkflowForRuntime(workflow),
      message
    };
  }

  private findExecutableWorkflow(matches: Array<{ metadata?: Record<string, unknown> }>, appId: string): Workflow | undefined {
    for (const match of matches) {
      const workflowId = match.metadata?.workflowId;
      if (typeof workflowId !== "string") continue;

      try {
        const workflow = this.repositories.getWorkflow(workflowId);
        if (workflow.status === "published" && workflow.appId === appId) return workflow;
      } catch (error) {
        if (error instanceof NotFoundError) {
          console.warn(`[runtime] Semantic search returned stale workflowId=${workflowId}; skipping.`);
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }
}

function sanitizeWorkflowForRuntime(workflow: Workflow): Workflow {
  if (workflow.status !== "published") {
    throw new AppError("WORKFLOW_NOT_PUBLISHED", "Cannot send unpublished workflow to SDK.", 403);
  }
  return workflow;
}
