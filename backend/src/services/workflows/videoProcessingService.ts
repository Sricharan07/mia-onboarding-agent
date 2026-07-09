import type { Repositories } from "../../db/repositories.js";
import { extractedActionTimelineSchema, type ExtractedActionTimeline, type UIElementRecord } from "../../schemas/domain.js";
import type { VideoUnderstandingAdapter } from "../../adapters/interfaces.js";
import { randomUUID } from "node:crypto";
import { WorkflowCompiler } from "./compiler.js";

const JOB_LEASE_MS = 30 * 60 * 1000;

export class VideoProcessingService {
  private readonly activeJobs = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  private readonly workerId = `video_${process.pid}_${randomUUID()}`;
  private closing = false;

  constructor(
    private readonly repositories: Repositories,
    private readonly videoUnderstanding: VideoUnderstandingAdapter,
    private readonly compiler: WorkflowCompiler
  ) {}

  startJob(jobId: string, onError?: (error: unknown) => void): { jobId: string; status: string } {
    if (this.closing) return { jobId, status: "stopping" };
    const job = this.repositories.getWorkflowJob(jobId);
    this.repositories.getActiveApp(String(job.app_id));
    const status = String(job.status);
    if (!["uploaded", "analyzing", "mapped", "failed"].includes(status)) {
      return { jobId, status };
    }
    if (this.activeJobs.has(jobId)) {
      return { jobId, status: "analyzing" };
    }
    if (!this.repositories.claimWorkflowJob(jobId, this.workerId, leaseUntil(JOB_LEASE_MS))) {
      return { jobId, status: "analyzing" };
    }

    const controller = new AbortController();
    const promise = this.processClaimedJob(jobId, controller.signal)
      .catch((error) => onError?.(error))
      .finally(() => {
        this.activeJobs.delete(jobId);
      });
    this.activeJobs.set(jobId, { promise, controller });
    return { jobId, status: "analyzing" };
  }

  resumeUnfinishedJobs(onError?: (error: unknown) => void): void {
    for (const job of this.repositories.listUnfinishedWorkflowJobs()) {
      this.startJob(job.id, onError);
    }
  }

  async processJob(jobId: string): Promise<void> {
    const job = this.repositories.getWorkflowJob(jobId);
    this.repositories.getActiveApp(String(job.app_id));
    if (!this.repositories.claimWorkflowJob(jobId, this.workerId, leaseUntil(JOB_LEASE_MS))) {
      return;
    }
    await this.processClaimedJob(jobId);
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const active of this.activeJobs.values()) active.controller.abort(new Error("Backend is shutting down."));
    await Promise.allSettled([...this.activeJobs.values()].map((active) => active.promise));
  }

  private async processClaimedJob(jobId: string, signal?: AbortSignal): Promise<void> {
    const heartbeat = setInterval(() => {
      this.repositories.refreshWorkflowJobLease(jobId, this.workerId, leaseUntil(JOB_LEASE_MS));
    }, Math.floor(JOB_LEASE_MS / 3));

    try {
      const job = this.repositories.getWorkflowJob(jobId);
      const video = this.repositories.getWorkflowVideo(String(job.video_id));
      const timeline = parseStoredTimeline(job.extracted_action_timeline_json)
        ?? await this.extractAndStoreTimeline(jobId, job, video, signal);
      if (signal?.aborted) throw signal.reason;
      const workflow = await this.compiler.compile({
        appId: String(job.app_id),
        timeline,
        videoId: String(job.video_id),
        jobId,
        requestedName: optionalString(video.workflow_name),
        requestedDescription: optionalString(video.workflow_description),
        signal
      });
      this.repositories.saveWorkflow(workflow);
      this.repositories.updateWorkflowJob(jobId, { status: "needs_review", error: null });
    } catch (error) {
      if (signal?.aborted) {
        this.repositories.releaseWorkflowJob(jobId, this.workerId);
        return;
      }
      this.repositories.updateWorkflowJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async extractAndStoreTimeline(jobId: string, job: Record<string, unknown>, video: Record<string, unknown>, signal?: AbortSignal): Promise<ExtractedActionTimeline> {
    const uiElements = this.repositories.listLatestUiElementsForApp(String(job.app_id), 160);
    const knownRoutes = Array.from(new Set(uiElements.map((element) => element.route))).filter(Boolean);
    const timelineResult = await this.videoUnderstanding.extractActionTimeline({
      videoPath: String(video.local_path),
      signal,
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
    return timelineResult.timeline;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseStoredTimeline(value: unknown): ExtractedActionTimeline | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return extractedActionTimelineSchema.parse(JSON.parse(value));
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

function leaseUntil(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
