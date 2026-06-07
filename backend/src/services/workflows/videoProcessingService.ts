import type { Repositories } from "../../db/repositories.js";
import type { UIElementRecord } from "../../schemas/domain.js";
import type { VideoUnderstandingAdapter } from "../../adapters/interfaces.js";
import { WorkflowCompiler } from "./compiler.js";

export class VideoProcessingService {
  constructor(
    private readonly repositories: Repositories,
    private readonly videoUnderstanding: VideoUnderstandingAdapter,
    private readonly compiler: WorkflowCompiler
  ) {}

  async processJob(jobId: string): Promise<void> {
    const job = this.repositories.getWorkflowJob(jobId);
    const video = this.repositories.getWorkflowVideo(String(job.video_id));
    this.repositories.updateWorkflowJob(jobId, { status: "analyzing", error: null });

    try {
      const uiElements = this.repositories.listLatestUiElementsForApp(String(job.app_id), 160);
      const knownRoutes = Array.from(new Set(uiElements.map((element) => element.route))).filter(Boolean);
      const timelineResult = await this.videoUnderstanding.extractActionTimeline({
        videoPath: String(video.local_path),
        appContext: {
          appName: String(job.app_id),
          knownRoutes,
          uiMapSummary: summarizeUiMap(uiElements)
        }
      });
      this.repositories.updateWorkflowJob(jobId, {
        status: "mapped",
        rawOutput: timelineResult.raw,
        timeline: timelineResult.timeline,
        error: null
      });
      const workflow = await this.compiler.compile({
        appId: String(job.app_id),
        timeline: timelineResult.timeline,
        videoId: String(job.video_id),
        jobId
      });
      this.repositories.saveWorkflow(workflow);
      this.repositories.updateWorkflowJob(jobId, { status: "needs_review", error: null });
    } catch (error) {
      this.repositories.updateWorkflowJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

function summarizeUiMap(elements: UIElementRecord[]): string | undefined {
  if (!elements.length) return undefined;
  return elements
    .map((element) => [
      `route=${element.route}`,
      `page=${element.pageName}`,
      `type=${element.elementType}`,
      `label=${element.label ?? element.elementId}`,
      `quality=${element.selectorQuality}`,
      `selector=${element.selector}`
    ].join("; "))
    .join("\n");
}
