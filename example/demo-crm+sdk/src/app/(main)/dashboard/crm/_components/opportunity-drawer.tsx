"use client";

import * as React from "react";

import { CheckCircle2, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CrmActivity, CrmOpportunity, CrmTask, OpportunityPatch } from "@/lib/crm-types";

const stages = ["Proposal Sent", "Discovery", "Negotiation", "Qualified"] as const;
const healthOptions = ["On Track", "Needs Review", "At Risk", "On Hold"] as const;
const outcomes = ["open", "won", "lost"] as const;

type FormState = {
  account: string;
  contactName: string;
  owner: string;
  stage: CrmOpportunity["stage"];
  health: CrmOpportunity["health"];
  probability: string;
  priority: string;
  amount: string;
  closeDate: string;
  outcome: CrmOpportunity["outcome"];
  nextStep: string;
};

export function OpportunityDrawer({
  opportunity,
  open,
  tasks,
  activities,
  onOpenChange,
  onSave,
  onAddNote,
  onCompleteTask,
}: {
  opportunity: CrmOpportunity | null;
  open: boolean;
  tasks: CrmTask[];
  activities: CrmActivity[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, patch: OpportunityPatch) => Promise<void>;
  onAddNote: (id: string, body: string) => Promise<void>;
  onCompleteTask: (taskId: string) => Promise<void>;
}) {
  const [form, setForm] = React.useState<FormState | null>(null);
  const [noteBody, setNoteBody] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!opportunity) {
      setForm(null);
      setNoteBody("");
      return;
    }
    setForm({
      account: opportunity.account,
      contactName: opportunity.contactName,
      owner: opportunity.owner,
      stage: opportunity.stage,
      health: opportunity.health,
      probability: String(opportunity.probability),
      priority: String(opportunity.priority),
      amount: String(opportunity.amount),
      closeDate: opportunity.closeDate,
      outcome: opportunity.outcome,
      nextStep: opportunity.nextStep,
    });
    setNoteBody("");
  }, [opportunity]);

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveChanges = async () => {
    if (!opportunity || !form) return;
    setSaving(true);
    try {
      await onSave(opportunity.id, {
        account: form.account,
        contactName: form.contactName,
        owner: form.owner,
        stage: form.stage,
        health: form.health,
        probability: Number(form.probability),
        priority: Number(form.priority),
        amount: Number(form.amount),
        closeDate: form.closeDate,
        outcome: form.outcome,
        nextStep: form.nextStep,
      });
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!opportunity || !noteBody.trim()) return;
    setSaving(true);
    try {
      await onAddNote(opportunity.id, noteBody.trim());
      setNoteBody("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{opportunity?.account ?? "Opportunity"}</SheetTitle>
          <SheetDescription>Edit deal details, add notes, and review recent CRM activity.</SheetDescription>
        </SheetHeader>
        {opportunity && form ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ScrollArea className="min-h-0 flex-1 px-4">
              <div className="space-y-5 pb-6">
                <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Account">
                    <Input
                      data-mia-key="crm.opportunity.account_input"
                      value={form.account}
                      onChange={(event) => updateForm("account", event.target.value)}
                    />
                  </Field>
                  <Field label="Contact">
                    <Input
                      data-mia-key="crm.opportunity.contact_input"
                      value={form.contactName}
                      onChange={(event) => updateForm("contactName", event.target.value)}
                    />
                  </Field>
                  <Field label="Owner">
                    <Input
                      data-mia-key="crm.opportunity.owner_input"
                      value={form.owner}
                      onChange={(event) => updateForm("owner", event.target.value)}
                    />
                  </Field>
                  <Field label="Stage">
                    <NativeSelect
                      data-mia-key="crm.opportunity.stage_select"
                      value={form.stage}
                      onChange={(event) => updateForm("stage", event.target.value as FormState["stage"])}
                      className="w-full"
                    >
                      {stages.map((stage) => (
                        <NativeSelectOption key={stage} value={stage}>
                          {stage}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Health">
                    <NativeSelect
                      data-mia-key="crm.opportunity.health_select"
                      value={form.health}
                      onChange={(event) => updateForm("health", event.target.value as FormState["health"])}
                      className="w-full"
                    >
                      {healthOptions.map((health) => (
                        <NativeSelectOption key={health} value={health}>
                          {health}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Outcome">
                    <NativeSelect
                      data-mia-key="crm.opportunity.outcome_select"
                      value={form.outcome}
                      onChange={(event) => updateForm("outcome", event.target.value as FormState["outcome"])}
                      className="w-full"
                    >
                      {outcomes.map((outcome) => (
                        <NativeSelectOption key={outcome} value={outcome}>
                          {outcome}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Probability">
                    <Input
                      data-mia-key="crm.opportunity.probability_input"
                      type="number"
                      min={0}
                      max={100}
                      value={form.probability}
                      onChange={(event) => updateForm("probability", event.target.value)}
                    />
                  </Field>
                  <Field label="Priority">
                    <Input
                      data-mia-key="crm.opportunity.priority_input"
                      type="number"
                      min={1}
                      max={5}
                      value={form.priority}
                      onChange={(event) => updateForm("priority", event.target.value)}
                    />
                  </Field>
                  <Field label="Amount">
                    <Input
                      data-mia-key="crm.opportunity.amount_input"
                      type="number"
                      min={0}
                      value={form.amount}
                      onChange={(event) => updateForm("amount", event.target.value)}
                    />
                  </Field>
                  <Field label="Close date">
                    <Input
                      data-mia-key="crm.opportunity.close_date_input"
                      type="date"
                      value={form.closeDate}
                      onChange={(event) => updateForm("closeDate", event.target.value)}
                    />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Next step">
                      <Textarea
                        data-mia-key="crm.opportunity.next_step_textarea"
                        value={form.nextStep}
                        onChange={(event) => updateForm("nextStep", event.target.value)}
                      />
                    </Field>
                  </div>
                </section>

                <div className="flex justify-end">
                  <Button data-mia-key="crm.opportunity.save_button" onClick={saveChanges} disabled={saving}>
                    <Save />
                    Save changes
                  </Button>
                </div>

                <section className="space-y-3 rounded-lg border p-3">
                  <div>
                    <h3 className="font-medium">Add note</h3>
                    <p className="text-muted-foreground text-sm">
                      Notes persist across refreshes and add a CRM activity row.
                    </p>
                  </div>
                  <Textarea
                    data-mia-key="crm.opportunity.note_textarea"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    placeholder="Add call outcome or follow-up detail..."
                  />
                  <Button
                    data-mia-key="crm.opportunity.add_note_button"
                    variant="outline"
                    onClick={addNote}
                    disabled={saving || !noteBody.trim()}
                  >
                    Add note
                  </Button>
                </section>

                {tasks.length > 0 ? (
                  <section className="space-y-3 rounded-lg border p-3">
                    <h3 className="font-medium">Open tasks</h3>
                    {tasks.map((task) => (
                      <div key={task.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-2">
                        <div>
                          <div className="font-medium text-sm">{task.title}</div>
                          <div className="text-muted-foreground text-xs">
                            {task.dueAt} · {task.status}
                          </div>
                        </div>
                        <Button
                          data-mia-key={`crm.opportunity.task.${task.id}.complete_button`}
                          variant="outline"
                          size="sm"
                          disabled={task.status === "completed"}
                          onClick={() => onCompleteTask(task.id)}
                        >
                          <CheckCircle2 />
                          Complete
                        </Button>
                      </div>
                    ))}
                  </section>
                ) : null}

                <section className="space-y-3">
                  <h3 className="font-medium">Notes and activity</h3>
                  {opportunity.notes.map((note) => (
                    <div key={note.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="font-medium text-sm">{note.author}</span>
                        <span className="text-muted-foreground text-xs">{note.createdAt}</span>
                      </div>
                      <p className="text-sm">{note.body}</p>
                    </div>
                  ))}
                  {activities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-2 rounded-lg border p-3">
                      <Badge variant="outline">{activity.type}</Badge>
                      <div>
                        <div className="text-sm">{activity.title}</div>
                        <div className="text-muted-foreground text-xs">
                          {activity.actor} · {activity.timestamp}
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
