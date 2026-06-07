import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { extractedActionTimelineSchema, type ExtractedActionTimeline } from "../schemas/domain.js";
import { AppError } from "../utils/errors.js";
import type { ModelGatewayAdapter, VideoUnderstandingAdapter } from "./interfaces.js";

export class QwenVideoUnderstandingAdapter implements VideoUnderstandingAdapter {
  constructor(private readonly config: AppConfig, private readonly gateway: ModelGatewayAdapter) {}

  async extractActionTimeline(input: {
    videoPath: string;
    appContext: {
      appName: string;
      knownRoutes: string[];
      uiMapSummary?: string;
    };
  }): Promise<{ timeline: ExtractedActionTimeline; raw: unknown }> {
    const prompt = buildPrompt(input.appContext);
    const result = await this.gateway.analyzeImagesOrVideo<unknown>({
      videoPath: input.videoPath,
      model: this.config.QWEN_VISION_MODEL ?? this.config.QWEN_MODEL,
      prompt
    });

    const parsed = extractedActionTimelineSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError("QWEN_TIMELINE_INVALID", "Qwen returned an invalid action timeline.", 502, parsed.error.issues);
    }

    return { timeline: parsed.data, raw: result.raw };
  }
}

function buildPrompt(appContext: { appName: string; knownRoutes: string[]; uiMapSummary?: string }): string {
  return `You are analyzing a screen recording of a SaaS workflow.

Your task:
- Identify the user's goal.
- Identify the pages used.
- Identify each visible action in order.
- Use only actions visible in the recording.
- Do not guess selectors.
- Do not produce executable instructions.
- Output valid JSON only.

Return this JSON shape:
{
  "goal": "string",
  "summary": "string",
  "steps": [
    {
      "id": "string",
      "order": number,
      "page": "string|null",
      "route": "string|null",
      "action": "navigate|click|focus|fill|select|wait|unknown",
      "observedElement": "string|null",
      "observedValueType": "text|email|password|number|date|unknown|null",
      "observedValueExample": "string|null",
      "visualContext": "string|null",
      "timestampStartMs": number|null,
      "timestampEndMs": number|null,
      "confidence": number
    }
  ]
}

Known app: ${appContext.appName}
Known routes:
${appContext.knownRoutes.map((route) => `- ${route}`).join("\n")}

Known UI summary:
${appContext.uiMapSummary ?? "No UI summary available."}`;
}
