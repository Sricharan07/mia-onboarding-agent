import { Check, FileVideo, Plus, Play, RefreshCw, Save, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, ExecutionPolicy, UiElement, Workflow, WorkflowJob, WorkflowReviewReport, WorkflowStep, WorkflowSummary } from "../api";
import { ActionEmptyState, InlineAlert, PageIntro, Panel, StatusBadge, StatusPill, SummaryItem } from "../components/console";
import { describeStep, errorMessage, formatDate } from "../utils/format";

type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };

export function UploadWorkflowPage({
  app,
  api,
  refresh,
  showToast,
  onJobs
}: {
  app: AppRecord | null;
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  showToast: (message: string) => void;
  onJobs: () => void;
}) {
  const [workflowName, setWorkflowName] = useState("New onboarding workflow");
  const [description, setDescription] = useState("Recorded workflow video for Mia to understand and compile.");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const upload = async () => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before uploading workflow videos." });
      showToast("Create an app first.");
      return;
    }
    if (!file) {
      setNotice({ tone: "yellow", title: "No video selected", message: "Choose a workflow recording before uploading." });
      showToast("Choose a workflow video first.");
      return;
    }
    try {
      const result = await api.uploadWorkflowVideo(app.id, { file, name: workflowName, description });
      await api.processWorkflowJob(result.jobId);
      await refresh(app.id);
      setNotice(null);
      showToast("Workflow video uploaded and processing started");
      onJobs();
    } catch (cause) {
      reportNotice(cause, "Unable to upload workflow video");
    }
  };

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <div className="inline-header compact">
        <button className="button secondary" type="button" onClick={onJobs}>Back to workflows</button>
      </div>
      <PageIntro
        title="Turn a product walkthrough into a guided workflow"
        description="Upload one focused recording at a time. Mia will compile it into editable steps, then an admin reviews targets and safety before publishing."
        action={<StatusBadge status={file ? "uploaded" : "draft"} />}
      />
      <section className="workbench-grid">
        <Panel title="Recording details" action={file ? <StatusPill tone="green" label={file.name} /> : <StatusPill tone="gray" label="No file" />}>
          <div className="form-grid single">
            <div>
              <div className="field-label">Video file</div>
              <label className={`file-dropzone ${file ? "has-file" : ""}`} htmlFor="workflow-video-file">
                <FileVideo size={18} />
                <span>
                  <strong>{file ? file.name : "Choose a walkthrough recording"}</strong>
                  <small>{file ? `${formatBytes(file.size)} selected` : "MP4, MOV, or WebM. Keep it to one clear user task."}</small>
                </span>
                <input
                  id="workflow-video-file"
                  className="visually-hidden"
                  type="file"
                  accept="video/*"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <label>
              Workflow name
              <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
            </label>
          </div>
          <div className="panel-actions">
            <button className="button primary" type="button" onClick={() => void upload()}>
              <Upload size={16} />
              Upload and process
            </button>
          </div>
        </Panel>

        <Panel title="Before upload">
          <div className="operator-step-list">
            <ReviewCheck title="One workflow per recording" done detail="Keep the video focused on a single user task." />
            <ReviewCheck title="Use realistic test data" done detail="Do not record secrets, customer data, or production-only actions." />
            <ReviewCheck title="Review before publish" done={false} detail="Generated steps are drafts until an admin confirms targets and policies." />
          </div>
        </Panel>
      </section>
    </div>
  );

  function reportNotice(cause: unknown, fallback: string) {
    const message = errorMessage(cause, fallback);
    setNotice({ tone: "red", title: "Upload failed", message });
    showToast(message);
  }
}

export function WorkflowReviewPage({
  workflow,
  workflows,
  api,
  refresh,
  selectWorkflow,
  onUpload,
  onBack,
  reviewerEmail,
  elements,
  showToast
}: {
  workflow: Workflow | null;
  workflows: WorkflowSummary[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
  onUpload: () => void;
  onBack: () => void;
  reviewerEmail?: string;
  elements: UiElement[];
  showToast: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerPhrases, setTriggerPhrases] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reviewReport, setReviewReport] = useState<WorkflowReviewReport | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    setName(workflow?.name ?? "");
    setDescription(workflow?.description ?? "");
    setTriggerPhrases(workflow?.triggerPhrases.join("\n") ?? "");
  }, [workflow]);

  useEffect(() => {
    if (!workflow) {
      setReviewReport(null);
      return;
    }
    void api.getWorkflowReviewReport(workflow.workflowId)
      .then(setReviewReport)
      .catch((cause) => reportNotice(cause, "Unable to load workflow review report"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workflow?.workflowId]);

  if (!workflow) {
    return (
      <div className="page-grid">
        <div className="inline-header compact">
          <button className="button secondary" type="button" onClick={onBack}>Back to workflows</button>
        </div>
        <PageIntro
          title="Review the workflow before users can run it"
          description="Generated workflows stay in draft form until an admin confirms the trigger phrases, target elements, execution policy, and safety report."
          action={<StatusPill tone="gray" label="No draft selected" />}
        />
        <ActionEmptyState
          title="No workflow draft is ready for review"
          message="Upload a walkthrough recording first. Once processing creates a draft, this page becomes the approval workspace."
          action={<button className="button primary" type="button" onClick={onUpload}><Upload size={16} />Upload recording</button>}
        />
      </div>
    );
  }

  const save = async () => {
    setPendingAction("save-metadata");
    try {
      await api.updateWorkflow(workflow.workflowId, {
        name,
        description,
        triggerPhrases: triggerPhrases.split("\n").map((phrase) => phrase.trim()).filter(Boolean)
      });
      await selectWorkflow(workflow.workflowId);
      setNotice(null);
      showToast("Workflow draft saved");
    } catch (cause) {
      reportNotice(cause, "Unable to save workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const approve = async () => {
    setPendingAction("approve");
    try {
      await api.approveWorkflow(workflow.workflowId, { reviewedBy: reviewerEmail ?? "console admin", notes });
      await refresh(workflow.appId);
      await selectWorkflow(workflow.workflowId);
      setNotice(null);
      showToast("Workflow approved");
    } catch (cause) {
      reportNotice(cause, "Unable to approve workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const publish = async () => {
    setPendingAction("publish");
    try {
      await api.publishWorkflow(workflow.workflowId);
      await refresh(workflow.appId);
      await selectWorkflow(workflow.workflowId);
      setNotice(null);
      showToast("Workflow published");
    } catch (cause) {
      reportNotice(cause, "Unable to publish workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const archive = async () => {
    setPendingAction("archive");
    try {
      await api.archiveWorkflow(workflow.workflowId);
      await refresh(workflow.appId);
      await selectWorkflow(workflow.workflowId);
      setNotice(null);
      showToast("Workflow archived");
    } catch (cause) {
      reportNotice(cause, "Unable to archive workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const reloadEditedWorkflow = async (message: string) => {
    await refresh(workflow.appId);
    await selectWorkflow(workflow.workflowId);
    setReviewReport(await api.getWorkflowReviewReport(workflow.workflowId));
    setNotice(null);
    showToast(message);
  };

  const addStep = async () => {
    setPendingAction("add-step");
    try {
      await api.addWorkflowStep(workflow.workflowId, {
        id: `step_${crypto.randomUUID()}`,
        type: "complete",
        message: "Describe the next safe workflow action."
      });
      await reloadEditedWorkflow("Step added");
    } catch (cause) {
      reportNotice(cause, "Unable to add step");
    } finally {
      setPendingAction(null);
    }
  };

  const updateStep = async (stepId: string, patch: Partial<WorkflowStep>) => {
    setPendingAction(`update-step:${stepId}`);
    try {
      await api.updateWorkflowStep(workflow.workflowId, stepId, patch);
      await reloadEditedWorkflow("Step saved");
    } catch (cause) {
      reportNotice(cause, "Unable to save step");
    } finally {
      setPendingAction(null);
    }
  };

  const deleteStep = async (stepId: string) => {
    setPendingAction(`delete-step:${stepId}`);
    try {
      await api.deleteWorkflowStep(workflow.workflowId, stepId);
      await reloadEditedWorkflow("Step deleted");
    } catch (cause) {
      reportNotice(cause, "Unable to delete step");
    } finally {
      setPendingAction(null);
    }
  };

  const moveStep = async (stepId: string, direction: -1 | 1) => {
    const currentIndex = workflow.steps.findIndex((step) => step.id === stepId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= workflow.steps.length) return;
    const stepIds = workflow.steps.map((step) => step.id);
    const [moved] = stepIds.splice(currentIndex, 1);
    stepIds.splice(nextIndex, 0, moved);
    setPendingAction(`move-step:${stepId}`);
    try {
      await api.reorderWorkflowSteps(workflow.workflowId, stepIds);
      await reloadEditedWorkflow("Steps reordered");
    } catch (cause) {
      reportNotice(cause, "Unable to reorder steps");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <div className="inline-header compact">
        <button className="button secondary" type="button" onClick={onBack}>Back to workflows</button>
      </div>
      <PageIntro
        title="Review the workflow before users can run it"
        description="Confirm the trigger phrases, every target element, and each execution policy. Publishing is disabled until the safety report clears."
        action={<StatusBadge status={workflow.status} />}
      />
      <Panel
        title="Workflow review"
        action={
          <select value={workflow.workflowId} onChange={(event) => void selectWorkflow(event.target.value)}>
            {workflows.map((item) => (
              <option value={item.workflowId} key={item.workflowId}>{item.name}</option>
            ))}
          </select>
        }
      >
        <div className="review-header">
          <div className="form-grid">
            <label>
              Workflow name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Description
              <input value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label>
              Trigger phrases
              <textarea value={triggerPhrases} onChange={(event) => setTriggerPhrases(event.target.value)} rows={4} />
            </label>
            <label>
              Review notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
            </label>
          </div>
          <div className="summary-grid">
            <SummaryItem label="Status" value={<StatusBadge status={workflow.status} />} />
            <SummaryItem label="Version" value={`v${workflow.version}`} />
            <SummaryItem label="Required app" value={workflow.requiredContext.app} />
            <SummaryItem label="Starting routes" value={workflow.requiredContext.startingRoutes.join(", ") || "Any"} />
          </div>
        </div>
      </Panel>

      <Panel title="Publish readiness" action={<StatusPill tone={reviewReport?.publishable ? "green" : "red"} label={reviewReport?.publishable ? "ready to approve" : "blocked"} />}>
        <div className="map-guide-grid">
          <ReviewCheck title="Name and description" done={Boolean(name.trim() && description.trim())} detail={name.trim() && description.trim() ? "Workflow metadata is readable." : "Add a clear name and description before publishing."} />
          <ReviewCheck title="Trigger phrases" done={triggerPhrases.split("\n").some((phrase) => phrase.trim())} detail="Users need natural phrases that map to this workflow." />
          <ReviewCheck title="Executable steps" done={workflow.steps.length > 0} detail={`${workflow.steps.length} step(s) generated.`} />
          <ReviewCheck title="Safety report" done={Boolean(reviewReport?.publishable)} detail={reviewReport?.publishable ? "No blockers found." : `${reviewReport?.blockerCount ?? 0} blocker(s), ${reviewReport?.warningCount ?? 0} warning(s).`} />
        </div>
      </Panel>

      <section className="review-layout">
        <div className="step-stack">
          <div className="inline-header compact">
            <div>
              <h2>Workflow steps</h2>
              <p>Review each user-facing action, target, and safety policy before publishing.</p>
            </div>
            <button
              className="button secondary small"
              data-testid="workflow-add-step"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => addStep()}
            >
              <Plus size={14} />
              {pendingAction === "add-step" ? "Adding" : "Add step"}
            </button>
          </div>
          {workflow.steps.map((step, index) => (
            <WorkflowStepCard
              key={step.id}
              step={step}
              elements={elements}
              order={index + 1}
              disabled={pendingAction !== null}
              onUpdate={(patch) => updateStep(step.id, patch)}
              onDelete={() => deleteStep(step.id)}
              onMove={(direction) => moveStep(step.id, direction)}
            />
          ))}
        </div>

        <aside className="review-side">
          <Panel title="Safety report" action={<StatusPill tone={reviewReport?.publishable ? "green" : "red"} label={reviewReport?.publishable ? "clear" : "blocked"} />}>
            <div className="review-issue-list">
              {!reviewReport && <div className="empty-state">Loading review report.</div>}
              {reviewReport?.issues.length === 0 && <div className="empty-state">No blockers or warnings found.</div>}
              {reviewReport?.issues.map((issue) => (
                <div className="review-issue" key={issue.id}>
                  <StatusPill tone={issue.severity === "blocker" ? "red" : issue.severity === "warning" ? "yellow" : "gray"} label={issue.severity} />
                  <span>
                    <strong>{issue.label}</strong>
                    <span>{issue.message}{issue.fix ? ` ${issue.fix}` : ""}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Actions">
            <div className="action-grid">
              <button
                className="button secondary"
                data-testid="workflow-save-metadata"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => save()}
              >
                <Save size={16} />
                {pendingAction === "save-metadata" ? "Saving metadata" : "Save metadata"}
              </button>
              <button className="button secondary" type="button" disabled={pendingAction !== null || !reviewReport?.publishable} onClick={() => approve()}>
                <Check size={16} />
                {pendingAction === "approve" ? "Approving" : "Approve"}
              </button>
              <button className="button primary" type="button" disabled={pendingAction !== null || workflow.status !== "approved" || !reviewReport?.publishable} onClick={() => publish()}>
                <Play size={16} />
                {pendingAction === "publish" ? "Publishing" : "Publish"}
              </button>
              <button className="button secondary" type="button" disabled={pendingAction !== null} onClick={() => archive()}>
                <X size={16} />
                {pendingAction === "archive" ? "Archiving" : "Archive"}
              </button>
            </div>
          </Panel>
          <Panel title="Compiled workflow JSON" action={<button className="button secondary small" type="button" onClick={() => setRawOpen((open) => !open)}>Toggle</button>}>
            {rawOpen ? <pre className="json-viewer">{JSON.stringify(workflow, null, 2)}</pre> : <div className="empty-state">Raw JSON is hidden during normal review.</div>}
          </Panel>
        </aside>
      </section>
    </div>
  );

  function reportNotice(cause: unknown, fallback: string) {
    const message = errorMessage(cause, fallback);
    setNotice({ tone: "red", title: "Workflow action failed", message });
    showToast(message);
  }
}

export function WorkflowStepCard({
  step,
  order,
  disabled,
  onUpdate,
  onDelete,
  onMove,
  elements
}: {
  step: WorkflowStep;
  order: number;
  disabled: boolean;
  onUpdate: (patch: Partial<WorkflowStep>) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
  elements: UiElement[];
}) {
  const [label, setLabel] = useState(step.label ?? "");
  const [message, setMessage] = useState(stepText(step));
  const [resolutionAction, setResolutionAction] = useState<"click" | "focus" | "wait_for_element">(
    step.type === "review_required" && step.observedAction === "focus" ? "focus" : "click"
  );
  const [resolutionTargetId, setResolutionTargetId] = useState(elements[0]?.id ?? "");

  useEffect(() => {
    setLabel(step.label ?? "");
    setMessage(stepText(step));
    if (step.type === "review_required") {
      setResolutionAction(step.observedAction === "focus" ? "focus" : "click");
    }
  }, [step]);

  useEffect(() => {
    if (!resolutionTargetId && elements[0]) setResolutionTargetId(elements[0].id);
  }, [elements, resolutionTargetId]);

  const saveText = async () => {
    if (step.type === "ask_user") await onUpdate({ label, prompt: message } as Partial<WorkflowStep>);
    else if (step.type === "confirm" || step.type === "complete") await onUpdate({ label, message } as Partial<WorkflowStep>);
    else await onUpdate({ label, description: message } as Partial<WorkflowStep>);
  };

  const remapTarget = async (elementRowId: string) => {
    const element = elements.find((candidate) => candidate.id === elementRowId);
    if (!element || !("target" in step)) return;
    await onUpdate({
      target: targetFromElement(element),
      source: "source" in step && step.source
        ? { ...step.source, matchConfidence: 1 }
        : undefined
    } as Partial<WorkflowStep>);
  };

  const resolveReviewStep = async () => {
    const element = elements.find((candidate) => candidate.id === resolutionTargetId);
    if (!element || step.type !== "review_required") return;
    const source = { ...step.source, matchConfidence: 1 };
    if (resolutionAction === "wait_for_element") {
      await onUpdate({ type: "wait_for_element", target: targetFromElement(element), timeoutMs: 10_000, source } as unknown as Partial<WorkflowStep>);
      return;
    }
    await onUpdate({
      type: resolutionAction,
      target: targetFromElement(element),
      executionPolicy: "requires_confirmation",
      source
    } as unknown as Partial<WorkflowStep>);
  };

  return (
    <article className="step-card">
      <div className="step-card-header">
        <div>
          <h3>Step {order}: {humanStepTitle(step)}</h3>
          <p>{describeStep(step)}</p>
        </div>
        <div className="step-actions">
          {"executionPolicy" in step && <StatusBadge status={step.executionPolicy} />}
          <button className="icon-button" type="button" disabled={disabled} onClick={() => onMove(-1)}>Up</button>
          <button className="icon-button" type="button" disabled={disabled} onClick={() => onMove(1)}>Down</button>
          <button className="icon-button danger" type="button" disabled={disabled} onClick={() => onDelete()}>Remove</button>
        </div>
      </div>
      <div className="step-columns">
        {step.type === "review_required" && (
          <div className="step-column editor">
            <h4>Resolve recorded action</h4>
            <label>
              Action
              <select value={resolutionAction} onChange={(event) => setResolutionAction(event.target.value as typeof resolutionAction)}>
                <option value="click">Click with confirmation</option>
                <option value="focus">Focus with confirmation</option>
                <option value="wait_for_element">Wait for element</option>
              </select>
            </label>
            <label>
              Current mapped target
              <select value={resolutionTargetId} onChange={(event) => setResolutionTargetId(event.target.value)}>
                {elements.map((element) => <option value={element.id} key={element.id}>{element.route} - {element.label ?? element.elementId}</option>)}
              </select>
            </label>
            <button className="button secondary small" type="button" disabled={disabled || !resolutionTargetId} onClick={() => void resolveReviewStep()}>
              Resolve step
            </button>
          </div>
        )}
        {step.type !== "review_required" && <div className="step-column editor">
          <h4>Instruction</h4>
          <label>
            Label
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            {step.type === "ask_user" ? "Prompt" : step.type === "confirm" || step.type === "complete" ? "Message" : "Description"}
            <input value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          {"executionPolicy" in step && (
            <label>
              Execution policy
              <select value={step.executionPolicy} onChange={(event) => onUpdate({ executionPolicy: event.target.value as ExecutionPolicy } as Partial<WorkflowStep>)}>
                <option value="auto">Runs automatically</option>
                <option value="requires_confirmation">Asks the user first</option>
                <option value="manual_only">User does it manually</option>
                <option value="blocked">Blocked, Mia never does this</option>
              </select>
            </label>
          )}
          <button
            className="button secondary small"
            data-testid={`workflow-save-step-${step.id}`}
            type="button"
            disabled={disabled}
            onClick={() => saveText()}
          >
            {disabled ? "Saving" : "Save step text"}
          </button>
        </div>}
        {"target" in step && (
          <div className="step-column">
            <h4>Target</h4>
            <label>
              Mapped element
              <select value={elements.find((element) => element.fingerprint === step.target.fingerprint && element.uiMapVersionId === step.target.uiMapVersionId)?.id ?? ""} onChange={(event) => void remapTarget(event.target.value)}>
                <option value="">Select current target</option>
                {elements.map((element) => <option value={element.id} key={element.id}>{element.route} - {element.label ?? element.elementId}</option>)}
              </select>
            </label>
            <button
              className="button secondary small"
              type="button"
              disabled={disabled || !elements.some((element) => element.elementId === step.target.elementId)}
              onClick={() => {
                const current = elements.find((element) => element.elementId === step.target.elementId);
                if (current) void remapTarget(current.id);
              }}
            >
              Rebind to latest map
            </button>
            <p>Element ID: {step.target.elementId}</p>
            <p>Label: {step.target.label ?? "None"}</p>
            <p>Selector: <code>{step.target.selector}</code></p>
          </div>
        )}
        {"source" in step && step.source && (
          <div className="step-column">
            <h4>Source match</h4>
            <p>Extracted step: {step.source.extractedStepId ?? "Unknown"}</p>
            <p>Match confidence: {step.source.matchConfidence?.toFixed(2) ?? "Unknown"}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function ReviewCheck({ title, done, detail }: { title: string; done: boolean; detail: string }) {
  return (
    <article className={`guide-step ${done ? "is-done" : ""}`}>
      <span>{done ? "OK" : "!"}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function humanStepTitle(step: WorkflowStep): string {
  if (step.type === "review_required") return "Resolve recorded action";
  if (step.type === "navigate") return `Open ${step.route}`;
  if (step.type === "ask_user") return step.label || step.prompt;
  if (step.type === "confirm" || step.type === "complete") return step.label || step.message;
  if ("target" in step) {
    const target = step.target.label ?? step.target.elementId;
    if (step.type === "click") return `Click ${target}`;
    if (step.type === "focus") return `Focus ${target}`;
    if (step.type === "fill") return `Fill ${target}`;
    if (step.type === "select") return `Select ${target}`;
    if (step.type === "wait_for_element") return `Wait for ${target}`;
  }
  return step.type;
}

export function WorkflowsPage({
  jobs,
  workflows,
  api,
  refresh,
  onReview,
  onUpload,
  showToast
}: {
  jobs: WorkflowJob[];
  workflows: WorkflowSummary[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onReview: (workflowId: string) => void;
  onUpload: () => void;
  showToast: (message: string) => void;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  // Jobs whose draft exists already show up as workflow cards below; only surface in-flight or failed ones here.
  const pendingJobs = jobs.filter((job) => !job.workflowId || job.error);

  const process = async (job: WorkflowJob) => {
    try {
      await api.processWorkflowJob(job.id);
      await refresh(job.appId);
      setNotice(null);
      showToast("Workflow processing started");
    } catch (cause) {
      const message = errorMessage(cause, "Unable to process job");
      setNotice({ tone: "red", title: "Processing failed", message });
      showToast(message);
    }
  };

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <PageIntro
        title="Workflows"
        description="Everything Mia can guide users through in this app. Upload a walkthrough recording, watch it become a draft, review it, and publish it."
        action={<button className="button primary" type="button" onClick={onUpload}><Upload size={16} />Upload recording</button>}
      />

      {pendingJobs.length > 0 && (
        <div className="job-card-list">
          {pendingJobs.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-card-main">
                <StatusBadge status={job.status} />
                <h3>{job.filename}</h3>
                <p>{job.error ? "Processing failed. Retry or upload a clearer recording." : "Mia is turning this recording into a reviewable draft."}</p>
                {job.error && <InlineAlert tone="red" title="Job error" message={job.error} />}
              </div>
              <div className="job-card-meta">
                <SummaryItem label="Uploaded" value={formatDate(job.createdAt)} />
                <div className="panel-actions">
                  <button className="button secondary small" type="button" onClick={() => void process(job)}>
                    <RefreshCw size={14} />
                    {job.error ? "Retry processing" : "Process now"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="workflow-card-grid">
        {workflows.length === 0 && pendingJobs.length === 0 && (
          <ActionEmptyState
            title="No workflows exist yet"
            message="Upload a focused walkthrough recording. Mia compiles it into editable steps, you review targets and safety, then publish it for users."
            action={<button className="button primary" type="button" onClick={onUpload}><Upload size={16} />Upload recording</button>}
          />
        )}
        {workflows.map((workflow) => (
          <article className="workflow-card" key={workflow.workflowId}>
            <div>
              <StatusBadge status={workflow.status} />
              <h3>{workflow.name}</h3>
              <p>{workflow.description}</p>
            </div>
            <div className="workflow-card-footer">
              <span>v{workflow.version}</span>
              <button className="button secondary small" type="button" onClick={() => onReview(workflow.workflowId)}>
                {workflow.status === "needs_review" ? "Review and publish" : "Open"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function stepText(step: WorkflowStep): string {
  if (step.type === "review_required") return step.message;
  if (step.type === "ask_user") return step.prompt;
  if (step.type === "confirm" || step.type === "complete") return step.message;
  return step.description ?? "";
}

function targetFromElement(element: UiElement) {
  return {
    elementId: element.elementId,
    label: element.label,
    selector: element.selector,
    fallbackSelectors: element.fallbackSelectors,
    route: element.route,
    pageName: element.pageName,
    uiMapVersionId: element.uiMapVersionId,
    fingerprint: element.fingerprint,
    elementType: element.elementType
  };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
