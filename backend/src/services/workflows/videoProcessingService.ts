import type { Repositories } from "../../db/repositories.js";
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
      const timelineResult = await this.videoUnderstanding.extractActionTimeline({
        videoPath: String(video.local_path),
        appContext: {
          appName: String(job.app_id),
          knownRoutes: [],
          uiMapSummary: undefined
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
