import { Archive, FileVideo2, Plus, RefreshCw, Save, Send, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackendApi } from "../api";
import { Alert, Button, EmptyState, Field, IconButton, Loading, Section, Segmented, StatusBadge } from "../components/ui";
import type { Recording, Skill, SkillStep } from "../types";
import { errorMessage, formatDateTime, lines } from "../utils/format";

type Tab = "skills" | "recordings";
type SkillDraft = Pick<Skill, "name" | "description" | "goal" | "businessContext" | "steps" | "constraints" | "expectedOutcomes">;

export function SkillsPage({ api, refreshNonce, notify }: { api: BackendApi; refreshNonce: number; notify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [recordingForm, setRecordingForm] = useState({ name: "", description: "" });
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [publishTarget, setPublishTarget] = useState<Skill | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextSkills, nextRecordings] = await Promise.all([api.skills(), api.recordings()]);
      setSkills(nextSkills); setRecordings(nextRecordings); setSelectedId((current) => current && nextSkills.some((skill) => skill.id === current) ? current : nextSkills[0]?.id ?? ""); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  useEffect(() => {
    const processing = recordings.some((recording) => ["uploaded", "processing"].includes(recording.status));
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [recordings, load]);
  const selected = useMemo(() => skills.find((skill) => skill.id === selectedId) ?? null, [skills, selectedId]);
  useEffect(() => { setDraft(selected ? toDraft(selected) : null); }, [selected]);

  const perform = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await work(); notify(message); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  if (loading) return <Loading label="Loading reviewed skills" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {publishTarget ? <Alert tone="warning" title={`Publish ${publishTarget.name}?`}>Mia can use this skill on the next product turn. <span className="alert-actions"><Button size="sm" disabled={busy} onClick={() => void perform(async () => { await api.publishSkill(publishTarget.id); setPublishTarget(null); }, "Skill published.")}><Send /> Publish</Button><Button size="sm" variant="secondary" onClick={() => setPublishTarget(null)}>Cancel</Button></span></Alert> : null}
      <div className="page-tools"><Segmented value={tab} onChange={setTab} label="Skills view" options={[{ value: "skills", label: "Skills", count: skills.filter((skill) => skill.status !== "archived").length }, { value: "recordings", label: "Recordings", count: recordings.length }]} /></div>

      {tab === "skills" ? (
        <div className="split-workspace">
          <aside className="selection-list" aria-label="Skills">
            <header><strong>Reviewed behavior</strong><span>{skills.filter((skill) => skill.status === "needs_review").length} need review</span></header>
            {skills.filter((skill) => skill.status !== "archived").map((skill) => <button type="button" key={skill.id} data-selected={skill.id === selectedId} onClick={() => setSelectedId(skill.id)}><div><strong>{skill.name}</strong><span>{skill.goal}</span></div><StatusBadge value={skill.status} /></button>)}
            {!skills.some((skill) => skill.status !== "archived") ? <EmptyState title="No skills yet" detail="Upload a product walkthrough recording to generate a reviewable skill." /> : null}
          </aside>
          <section className="detail-pane">
            {selected && draft ? (
              <form onSubmit={(event) => { event.preventDefault(); void perform(() => api.updateSkill(selected.id, draft), "Skill changes saved for review."); }}>
                <header className="detail-header"><div><div className="title-with-status"><h2>{selected.name}</h2><StatusBadge value={selected.status} /></div><p>Version {selected.version} - updated {formatDateTime(selected.updatedAt)}</p></div><div className="button-group"><Button type="submit" size="sm" variant="secondary" disabled={busy}><Save /> Save</Button>{selected.status !== "published" ? <Button type="button" size="sm" disabled={busy} onClick={() => setPublishTarget(selected)}><Send /> Publish</Button> : null}<IconButton label="Archive skill" disabled={busy} onClick={() => void perform(() => api.archiveSkill(selected.id), "Skill archived.")}><Archive /></IconButton></div></header>
                <div className="form-grid two">
                  <Field label="Name"><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
                  <Field label="Goal"><input required value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></Field>
                  <Field label="Description" className="span-2"><textarea rows={3} required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
                  <Field label="Business context" className="span-2"><textarea rows={3} value={draft.businessContext} onChange={(event) => setDraft({ ...draft, businessContext: event.target.value })} /></Field>
                </div>
                <div className="subsection-header"><div><h3>Successful pattern</h3><p>Intent-level steps adapt to the current live UI instead of replaying fixed selectors.</p></div><Button type="button" size="sm" variant="secondary" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { intent: "", context: "", expectedOutcome: "" }] })}><Plus /> Add step</Button></div>
                <div className="step-editor">{draft.steps.map((step, index) => <div key={index} className="step-row"><span>{index + 1}</span><Field label="Intent"><input required value={step.intent ?? stringifyStep(step)} onChange={(event) => updateStep(setDraft, draft, index, { ...step, intent: event.target.value })} /></Field><Field label="Context"><input value={typeof step.context === "string" ? step.context : ""} onChange={(event) => updateStep(setDraft, draft, index, { ...step, context: event.target.value })} /></Field><Field label="Expected outcome"><input value={typeof step.expectedOutcome === "string" ? step.expectedOutcome : ""} onChange={(event) => updateStep(setDraft, draft, index, { ...step, expectedOutcome: event.target.value })} /></Field><IconButton label={`Remove step ${index + 1}`} disabled={draft.steps.length === 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></IconButton></div>)}</div>
                <div className="form-grid two padded-top"><Field label="Constraints" hint="One reviewed constraint per line."><textarea rows={5} value={draft.constraints.join("\n")} onChange={(event) => setDraft({ ...draft, constraints: lines(event.target.value) })} /></Field><Field label="Expected outcomes" hint="One verifiable result per line."><textarea rows={5} value={draft.expectedOutcomes.join("\n")} onChange={(event) => setDraft({ ...draft, expectedOutcomes: lines(event.target.value) })} /></Field></div>
              </form>
            ) : <EmptyState title="Select a skill" detail="Choose a generated skill to inspect and publish its adaptive behavior." />}
          </section>
        </div>
      ) : (
        <Section title="Walkthrough recordings" description="Gemini converts each recording into a draft skill that requires review." action={<Button size="sm" onClick={() => setShowUpload((value) => !value)}><Upload /> Upload recording</Button>}>
          {showUpload ? <form className="panel-form three" onSubmit={(event: FormEvent) => { event.preventDefault(); if (recordingFile) void perform(async () => { await api.uploadRecording({ ...recordingForm, file: recordingFile }); setRecordingFile(null); setRecordingForm({ name: "", description: "" }); setShowUpload(false); }, "Recording analysis started."); }}><Field label="Name"><input required value={recordingForm.name} onChange={(event) => setRecordingForm((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Business context"><input value={recordingForm.description} onChange={(event) => setRecordingForm((current) => ({ ...current, description: event.target.value }))} /></Field><Field label="Video or audio"><input type="file" accept="video/*,audio/*" required onChange={(event) => setRecordingFile(event.target.files?.[0] ?? null)} /></Field><div className="form-actions span-3"><Button type="submit" disabled={busy || !recordingFile}>Upload and analyze</Button><Button type="button" variant="quiet" onClick={() => setShowUpload(false)}>Cancel</Button></div></form> : null}
          {recordings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Recording</th><th>Status</th><th>Uploaded</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{recordings.map((recording) => <tr key={recording.id}><td><div className="table-primary"><strong><FileVideo2 className="inline-icon" />{recording.name}</strong><span>{recording.description || "No context supplied"}</span>{recording.error ? <small className="text-danger">{recording.error}</small> : null}</div></td><td><StatusBadge value={recording.status} /></td><td>{formatDateTime(recording.createdAt)}</td><td>{recording.status === "failed" ? <Button size="sm" variant="quiet" disabled={busy} onClick={() => void perform(() => api.retryRecording(recording.id), "Recording analysis restarted.")}><RefreshCw /> Retry</Button> : null}</td></tr>)}</tbody></table></div> : <EmptyState title="No recordings" detail="Upload a completed product walkthrough to create the first reviewable skill." />}
        </Section>
      )}
    </div>
  );
}

function toDraft(skill: Skill): SkillDraft {
  return { name: skill.name, description: skill.description, goal: skill.goal, businessContext: skill.businessContext, steps: skill.steps.length ? skill.steps : [{ intent: "" }], constraints: skill.constraints, expectedOutcomes: skill.expectedOutcomes };
}

function stringifyStep(step: SkillStep): string {
  return Object.values(step).filter((value) => typeof value === "string").join(" - ");
}

function updateStep(setDraft: (value: SkillDraft) => void, draft: SkillDraft, index: number, step: SkillStep) {
  setDraft({ ...draft, steps: draft.steps.map((current, currentIndex) => currentIndex === index ? step : current) });
}
