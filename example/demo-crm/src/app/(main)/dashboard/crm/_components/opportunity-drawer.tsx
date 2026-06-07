"use client";

import * as React from "react";
import { Clock3, Plus, UserRound } from "lucide-react";

import {
  crmNoteSchema,
  opportunityHealthSchema,
  opportunityPatchSchema,
  opportunityStageSchema,
  type CrmActivity,
  type CrmOpportunity,
  type OpportunityOutcome,
  type OpportunityPatch,
} from "@/lib/crm-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type OpportunityFormState = {
  account: string;
  contactName: string;
  owner: string;
  stage: string;
  priority: string;
  health: string;
  amount: string;
  probability: string;
  closeDate: string;
  nextStep: string;
  outcome: OpportunityOutcome;
};

type OpportunityDrawerProps = {
  opportunity: CrmOpportunity | null;
  activities: CrmActivity[];
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (opportunityId: string, patch: OpportunityPatch) => Promise<void>;
  onAddNote: (opportunityId: string, body: string) => Promise<void>;
};

function toDateInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function fromDateInputValue(value: string) {
  return value ? new Date(`${value}T12:00:00.000Z`).toISOString() : "";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildFormState(opportunity: CrmOpportunity | null): OpportunityFormState {
  return {
    account: opportunity?.account ?? "",
    contactName: opportunity?.contactName ?? "",
    owner: opportunity?.owner ?? "",
    stage: opportunity?.stage ?? "Discovery",
    priority: opportunity?.priority?.toString() ?? "1",
    health: opportunity?.health ?? "On Track",
    amount: opportunity?.amount?.toString() ?? "",
    probability: opportunity?.probability?.toString() ?? "0",
    closeDate: toDateInputValue(opportunity?.closeDate ?? ""),
    nextStep: opportunity?.nextStep ?? "",
    outcome: opportunity?.outcome ?? "open",
  };
}

function buildPatch(formState: OpportunityFormState): OpportunityPatch {
  const payload: Record<string, unknown> = {
    account: formState.account,
    contactName: formState.contactName,
    owner: formState.owner,
    stage: opportunityStageSchema.parse(formState.stage),
    priority: Number(formState.priority),
    health: opportunityHealthSchema.parse(formState.health),
    amount: Number(formState.amount),
    probability: Number(formState.probability),
    nextStep: formState.nextStep,
    outcome: formState.outcome,
  };

  if (formState.closeDate) {
    payload.closeDate = fromDateInputValue(formState.closeDate);
  }

  return opportunityPatchSchema.parse(payload);
}

export function OpportunityDrawer({
  opportunity,
  activities,
  open,
  saving,
  onOpenChange,
  onSave,
  onAddNote,
}: OpportunityDrawerProps) {
  const [formState, setFormState] = React.useState<OpportunityFormState>(() => buildFormState(opportunity));
  const [noteBody, setNoteBody] = React.useState("");

  React.useEffect(() => {
    setFormState(buildFormState(opportunity));
    setNoteBody("");
  }, [opportunity]);

  if (!opportunity) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[42rem] overflow-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {opportunity.account}
            <Badge variant="outline" className="rounded-full px-2.5">
              {opportunity.stage}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            Real CRM record backed by local persistence. Update the opportunity, add notes, and keep the activity log
            moving without changing the layout.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ScrollArea className="min-h-0 flex-1 px-4">
            <div className="space-y-5 pb-4 pr-2">
            <div className="grid gap-4 rounded-lg border border-border/60 bg-muted/20 p-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Contact</div>
                <div className="font-medium">{opportunity.contactName}</div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <UserRound className="size-3.5" />
                  {opportunity.owner}
                </div>
              </div>
              <div className="space-y-1.5 md:text-right">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Value</div>
                <div className="font-medium text-2xl tabular-nums">{formatCurrency(opportunity.amount)}</div>
                <div className="text-sm text-muted-foreground">{opportunity.health}</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="crm-account">Account</Label>
                <Input
                  id="crm-account"
                  value={formState.account}
                  onChange={(event) => setFormState((current) => ({ ...current, account: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-contact">Contact</Label>
                <Input
                  id="crm-contact"
                  value={formState.contactName}
                  onChange={(event) => setFormState((current) => ({ ...current, contactName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-owner">Owner</Label>
                <Input
                  id="crm-owner"
                  value={formState.owner}
                  onChange={(event) => setFormState((current) => ({ ...current, owner: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-stage">Stage</Label>
                <Select
                  value={formState.stage}
                  onValueChange={(value) => setFormState((current) => ({ ...current, stage: value }))}
                >
                  <SelectTrigger id="crm-stage">
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {opportunityStageSchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-health">Health</Label>
                <Select
                  value={formState.health}
                  onValueChange={(value) => setFormState((current) => ({ ...current, health: value }))}
                >
                  <SelectTrigger id="crm-health">
                    <SelectValue placeholder="Select health" />
                  </SelectTrigger>
                  <SelectContent>
                    {opportunityHealthSchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-probability">Probability</Label>
                <Input
                  id="crm-probability"
                  type="number"
                  min={0}
                  max={100}
                  value={formState.probability}
                  onChange={(event) => setFormState((current) => ({ ...current, probability: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-priority">Priority</Label>
                <Input
                  id="crm-priority"
                  type="number"
                  min={1}
                  max={5}
                  value={formState.priority}
                  onChange={(event) => setFormState((current) => ({ ...current, priority: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-close-date">Close date</Label>
                <Input
                  id="crm-close-date"
                  type="date"
                  value={formState.closeDate}
                  onChange={(event) => setFormState((current) => ({ ...current, closeDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-outcome">Outcome</Label>
                <Select
                  value={formState.outcome}
                  onValueChange={(value) =>
                    setFormState((current) => ({ ...current, outcome: value as OpportunityOutcome }))
                  }
                >
                  <SelectTrigger id="crm-outcome">
                    <SelectValue placeholder="Select outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-next-step">Next step</Label>
              <Textarea
                id="crm-next-step"
                value={formState.nextStep}
                onChange={(event) => setFormState((current) => ({ ...current, nextStep: event.target.value }))}
                rows={4}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="size-4" />
                Last activity {formatDateTime(opportunity.lastActivityAt)}
              </div>
              <Button
                onClick={() => onSave(opportunity.id, buildPatch(formState))}
                disabled={saving}
                data-ai-id={`crm.opportunity.save.${opportunity.id}`}
              >
                Save changes
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Add note</div>
                  <div className="text-sm text-muted-foreground">Attach a real note to the opportunity timeline.</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => onAddNote(opportunity.id, noteBody)}
                  disabled={saving || !noteBody.trim()}
                >
                  <Plus className="mr-1 size-4" />
                  Add note
                </Button>
              </div>
              <Textarea
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                rows={4}
                placeholder="Capture the latest call notes or follow-up detail..."
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <div className="font-medium">Notes and activity</div>
                <div className="text-sm text-muted-foreground">Everything that changed on this record stays visible.</div>
              </div>
              <div className="space-y-3">
                {opportunity.notes.length ? (
                  opportunity.notes.map((note) => {
                    const validatedNote = crmNoteSchema.parse(note);

                    return (
                      <div key={validatedNote.id} className="rounded-lg border border-border/60 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-sm">{validatedNote.author}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(validatedNote.createdAt)}</div>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{validatedNote.body}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    No notes yet. Add the first customer note to make the record feel alive.
                  </div>
                )}

                {activities.length ? (
                  activities.map((activity) => (
                    <div key={activity.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-sm">{activity.title}</div>
                        <Badge variant="secondary" className="rounded-full px-2.5 text-[11px]">
                          {activity.type}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {activity.actor} • {formatDateTime(activity.timestamp)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    No CRM activity recorded for this opportunity yet.
                  </div>
                )}
              </div>
            </div>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
