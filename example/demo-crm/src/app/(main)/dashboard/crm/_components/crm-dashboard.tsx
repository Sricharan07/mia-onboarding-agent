"use client";

import * as React from "react";

import { toast } from "sonner";

import type { CrmOpportunity, CrmSnapshot, OpportunityPatch } from "@/lib/crm-types";
import { crmSnapshotSchema } from "@/lib/crm-types";

import { KpiCards } from "./kpi-cards";
import { OpportunityDrawer } from "./opportunity-drawer";
import { OpportunitiesSection } from "./opportunities-section";
import { PipelineActivity, type PipelineRange } from "./pipeline-activity";
import { TaskReminders } from "./task-reminders";

type CrmDashboardProps = {
  initialState: CrmSnapshot;
};

type MutationResponse = {
  state: CrmSnapshot;
};

async function mutateCrm(input: string, init: RequestInit): Promise<CrmSnapshot> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as MutationResponse | { error?: { message?: string } } | null;

  if (!response.ok) {
    throw new Error(payload && "error" in payload ? payload.error?.message ?? "Request failed." : "Request failed.");
  }

  return crmSnapshotSchema.parse((payload as MutationResponse).state);
}

export function CrmDashboard({ initialState }: CrmDashboardProps) {
  const [snapshot, setSnapshot] = React.useState(initialState);
  const [range, setRange] = React.useState<PipelineRange>("last-12-months");
  const [drawerOpportunityId, setDrawerOpportunityId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [savingOpportunity, setSavingOpportunity] = React.useState(false);

  const selectedOpportunity = React.useMemo(
    () => snapshot.opportunities.find((opportunity) => opportunity.id === drawerOpportunityId) ?? null,
    [drawerOpportunityId, snapshot.opportunities],
  );

  const opportunityActivities = React.useMemo(() => {
    if (!drawerOpportunityId) {
      return [];
    }

    return snapshot.activities.filter((activity) => activity.opportunityId === drawerOpportunityId).slice(0, 6);
  }, [drawerOpportunityId, snapshot.activities]);

  async function applyMutation(request: Promise<CrmSnapshot>, successMessage: string) {
    setSavingOpportunity(true);

    try {
      const nextState = await request;
      setSnapshot(nextState);
      toast.success(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update CRM.";
      toast.error(message);
      throw error;
    } finally {
      setSavingOpportunity(false);
    }
  }

  async function handleSaveOpportunity(opportunityId: string, patch: OpportunityPatch) {
    await applyMutation(
      mutateCrm(`/api/v1/crm/opportunities/${opportunityId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
      "Opportunity updated.",
    );
  }

  async function handleAddNote(opportunityId: string, body: string) {
    await applyMutation(
      mutateCrm(`/api/v1/crm/opportunities/${opportunityId}/notes`, {
        method: "POST",
        body: JSON.stringify({
          body,
          author: "Mia Assistant",
        }),
      }),
      "Note added.",
    );
  }

  async function handleCompleteMeeting(meetingId: string) {
    await applyMutation(
      mutateCrm(`/api/v1/crm/meetings/${meetingId}/complete`, {
        method: "POST",
      }),
      "Meeting marked complete.",
    );
  }

  function openOpportunity(opportunity: CrmOpportunity) {
    setDrawerOpportunityId(opportunity.id);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <KpiCards metrics={snapshot.metrics} />
      <PipelineActivity
        range={range}
        series={snapshot.pipelineSeries}
        discoveryCallsBooked={snapshot.metrics.discoveryCallsBooked}
        onRangeChange={setRange}
      />
      <TaskReminders
        meetings={snapshot.meetings}
        proposalGoal={snapshot.metrics.proposalGoal}
        proposalSent={snapshot.metrics.proposalSent}
        onCompleteMeeting={handleCompleteMeeting}
      />
      <OpportunitiesSection opportunities={snapshot.opportunities} onEditOpportunity={openOpportunity} />
      <OpportunityDrawer
        opportunity={selectedOpportunity}
        activities={opportunityActivities}
        open={drawerOpen}
        saving={savingOpportunity}
        onOpenChange={setDrawerOpen}
        onSave={handleSaveOpportunity}
        onAddNote={handleAddNote}
      />
    </div>
  );
}
