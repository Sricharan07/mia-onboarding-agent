import { Check, Plus, Play, RefreshCw, Save, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, ExecutionPolicy, Workflow, WorkflowJob, WorkflowStep, WorkflowSummary } from "../api";
import { EmptyTableRow, Panel, RawJsonViewer, StatusBadge, SummaryItem } from "../components/console";
import { describeStep, formatDate } from "../utils/format";

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

  const upload = async () => {
    if (!app) {
      showToast("Create an app first.");
      return;
    }
    if (!file) {
      showToast("Choose a workflow video first.");
      return;
    }
    try {
      const result = await api.uploadWorkflowVideo(app.id, { file, name: workflowName, description });
      await api.processWorkflowJob(result.jobId);
      await refresh(app.id);
      showToast("Workflow video uploaded and processing started");
      onJobs();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to upload workflow video");
    }
  };

  return (
    <div className="page-grid narrow">
      <Panel title="Upload workflow video" action={<StatusBadge status="uploaded" />}>
        <div className="form-grid single">
          <label>
            Video file
            <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
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
    </div>
  );
}

export function WorkflowJobsPage({
  jobs,
  workflows,
  api,
  refresh,
  onOpenWorkflow,
  showToast
}: {
  jobs: WorkflowJob[];
  workflows: WorkflowSummary[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onOpenWorkflow: (workflowId: string) => void;
  showToast: (message: string) => void;
}) {
  const process = async (job: WorkflowJob) => {
    try {
      await api.processWorkflowJob(job.id);
      await refresh(job.appId);
      showToast("Workflow processing started");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to process job");
    }
  };

  return (
    <Panel title="Workflow processing jobs">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Video filename</th>
            <th>Status</th>
            <th>Created</th>
            <th>Error</th>
            <th>Generated workflow</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && <EmptyTableRow colSpan={7} message="No workflow jobs yet." />}
          {jobs.map((job) => (
            <tr key={job.id}>
              <td><code>{job.id}</code></td>
              <td>{job.filename}</td>
              <td><StatusBadge status={job.status} /></td>
              <td>{formatDate(job.createdAt)}</td>
              <td>{job.error || <span className="muted">None</span>}</td>
              <td>{job.workflowId ? workflows.find((workflow) => workflow.workflowId === job.workflowId)?.name ?? job.workflowId : <span className="muted">Not ready</span>}</td>
              <td className="table-actions">
                <button className="button secondary small" type="button" onClick={() => void process(job)}>
                  <RefreshCw size={14} />
                  Process
                </button>
                {job.workflowId && (
                  <button className="button secondary small" type="button" onClick={() => onOpenWorkflow(job.workflowId!)}>
                    Open workflow
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function WorkflowReviewPage({
  workflow,
  workflows,
  api,
  refresh,
  selectWorkflow,
  showToast
}: {
  workflow: Workflow | null;
  workflows: WorkflowSummary[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerPhrases, setTriggerPhrases] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    setName(workflow?.name ?? "");
    setDescription(workflow?.description ?? "");
    setTriggerPhrases(workflow?.triggerPhrases.join("\n") ?? "");
  }, [workflow]);

  if (!workflow) {
    return (
      <Panel title="Workflow review">
        <div className="empty-state">No workflow selected. Upload and process a video first.</div>
      </Panel>
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
      showToast("Workflow draft saved");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to save workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const approve = async () => {
    setPendingAction("approve");
    try {
      await api.approveWorkflow(workflow.workflowId, { reviewedBy: "local-console", notes });
      await refresh(workflow.appId);
      await selectWorkflow(workflow.workflowId);
      showToast("Workflow approved");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to approve workflow");
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
      showToast("Workflow published");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to publish workflow");
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
      showToast("Workflow archived");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to archive workflow");
    } finally {
      setPendingAction(null);
    }
  };

  const reloadEditedWorkflow = async (message: string) => {
    await refresh(workflow.appId);
    await selectWorkflow(workflow.workflowId);
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
      showToast(cause instanceof Error ? cause.message : "Unable to add step");
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
      showToast(cause instanceof Error ? cause.message : "Unable to save step");
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
      showToast(cause instanceof Error ? cause.message : "Unable to delete step");
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
      showToast(cause instanceof Error ? cause.message : "Unable to reorder steps");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="page-grid">
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

      <section className="review-layout">
        <div className="step-stack">
          <div className="inline-header compact">
            <div>
              <h2>Workflow DSL steps</h2>
              <p>Edits are saved through backend step endpoints and revalidated before the workflow can be published.</p>
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
              order={index + 1}
              disabled={pendingAction !== null}
              onUpdate={(patch) => updateStep(step.id, patch)}
              onDelete={() => deleteStep(step.id)}
              onMove={(direction) => moveStep(step.id, direction)}
            />
          ))}
        </div>

        <aside className="review-side">
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
              <button className="button secondary" type="button" disabled={pendingAction !== null} onClick={() => approve()}>
                <Check size={16} />
                {pendingAction === "approve" ? "Approving" : "Approve"}
              </button>
              <button className="button primary" type="button" disabled={pendingAction !== null} onClick={() => publish()}>
                <Play size={16} />
                {pendingAction === "publish" ? "Publishing" : "Publish"}
              </button>
              <button className="button secondary" type="button" disabled={pendingAction !== null} onClick={() => archive()}>
                <X size={16} />
                {pendingAction === "archive" ? "Archiving" : "Archive"}
              </button>
            </div>
          </Panel>
          <RawJsonViewer title="Compiled workflow JSON" data={workflow} />
        </aside>
      </section>
    </div>
  );
}

export function WorkflowStepCard({
  step,
  order,
  disabled,
  onUpdate,
  onDelete,
  onMove
}: {
  step: WorkflowStep;
  order: number;
  disabled: boolean;
  onUpdate: (patch: Partial<WorkflowStep>) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
}) {
  const [label, setLabel] = useState(step.label ?? "");
  const [message, setMessage] = useState(stepText(step));

  useEffect(() => {
    setLabel(step.label ?? "");
    setMessage(stepText(step));
  }, [step]);

  const saveText = async () => {
    if (step.type === "ask_user") await onUpdate({ label, prompt: message } as Partial<WorkflowStep>);
    else if (step.type === "confirm" || step.type === "complete") await onUpdate({ label, message } as Partial<WorkflowStep>);
    else await onUpdate({ label, description: message } as Partial<WorkflowStep>);
  };

  return (
    <article className="step-card">
      <div className="step-card-header">
        <div>
          <h3>Step {order}: {step.type}</h3>
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
        <div className="step-column editor">
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
                <option value="auto">auto</option>
                <option value="requires_confirmation">requires_confirmation</option>
                <option value="manual_only">manual_only</option>
                <option value="blocked">blocked</option>
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
        </div>
        {"target" in step && (
          <div className="step-column">
            <h4>Target</h4>
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

export function WorkflowsPage({ workflows, onReview }: { workflows: WorkflowSummary[]; onReview: (workflowId: string) => void }) {
  return (
    <Panel title="Workflows">
      <table>
        <thead>
          <tr>
            <th>Workflow name</th>
            <th>Status</th>
            <th>Version</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {workflows.length === 0 && <EmptyTableRow colSpan={5} message="No workflows generated yet." />}
          {workflows.map((workflow) => (
            <tr key={workflow.workflowId}>
              <td>{workflow.name}</td>
              <td><StatusBadge status={workflow.status} /></td>
              <td>v{workflow.version}</td>
              <td>{workflow.description}</td>
              <td className="table-actions">
                <button className="button secondary small" type="button" onClick={() => onReview(workflow.workflowId)}>Review</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function stepText(step: WorkflowStep): string {
  if (step.type === "ask_user") return step.prompt;
  if (step.type === "confirm" || step.type === "complete") return step.message;
  return step.description ?? "";
}
