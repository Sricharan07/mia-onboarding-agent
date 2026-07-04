import type { AppConfig } from "../config/env.js";
import { extractedActionTimelineSchema, type ExtractedActionTimeline } from "../schemas/domain.js";
import { AppError } from "../utils/errors.js";
import type { ModelGatewayAdapter, VideoUnderstandingAdapter } from "./interfaces.js";

export class GeminiVideoUnderstandingAdapter implements VideoUnderstandingAdapter {
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
      model: this.config.GEMINI_VISION_MODEL ?? this.config.GEMINI_TEXT_MODEL,
      prompt,
      logContext: { appId: input.appContext.appName, purpose: "workflow_video_analysis" }
    });

    const parsed = extractedActionTimelineSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError("GEMINI_TIMELINE_INVALID", "Gemini returned an invalid action timeline.", 502, parsed.error.issues);
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
- Prefer observed element names that match the Known UI summary labels when the recording shows the same control.
- Use Known routes when a visible navigation/page clearly matches one.
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
