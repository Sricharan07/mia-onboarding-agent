"use client";

import * as React from "react";

import type { CrmOpportunity, CrmSnapshot, OpportunityPatch } from "@/lib/crm-types";

import { KpiCards } from "./kpi-cards";
import { OpportunitiesSection } from "./opportunities-section";
import { OpportunityDrawer } from "./opportunity-drawer";
import { PipelineActivity } from "./pipeline-activity";
import { TaskReminders } from "./task-reminders";

type CrmResponse = {
  state: CrmSnapshot;
};

export function CrmDashboard({ initialState }: { initialState: CrmSnapshot }) {
  const [state, setState] = React.useState(initialState);
  const [selectedOpportunityId, setSelectedOpportunityId] = React.useState<string | null>(null);
  const selectedOpportunity =
    state.opportunities.find((opportunity) => opportunity.id === selectedOpportunityId) ?? null;

  const updateFromResponse = async (response: Response) => {
    if (!response.ok) {
      throw new Error(`CRM request failed with HTTP ${response.status}`);
    }
    const data = (await response.json()) as CrmResponse;
    setState(data.state);
    return data.state;
  };

  const handleUpdateOpportunity = async (id: string, patch: OpportunityPatch) => {
    await updateFromResponse(
      await fetch(`/api/v1/crm/opportunities/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  };

  const handleAddOpportunityNote = async (id: string, body: string) => {
    await updateFromResponse(
      await fetch(`/api/v1/crm/opportunities/${encodeURIComponent(id)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, author: "Sales Ops" }),
      }),
    );
  };

  const handleCompleteMeeting = async (meetingId: string) => {
    await updateFromResponse(
      await fetch(`/api/v1/crm/meetings/${encodeURIComponent(meetingId)}/complete`, {
        method: "POST",
      }),
    );
  };

  const handleCompleteTask = async (taskId: string) => {
    await updateFromResponse(
      await fetch(`/api/v1/crm/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
      }),
    );
  };

  const handleOpenOpportunity = (opportunity: CrmOpportunity) => {
    setSelectedOpportunityId(opportunity.id);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <KpiCards metrics={state.metrics} />
      <PipelineActivity pipelineSeries={state.pipelineSeries} />
      <TaskReminders
        meetings={state.meetings}
        proposalSent={state.proposalSent}
        proposalGoal={state.proposalGoal}
        onCompleteMeeting={handleCompleteMeeting}
      />
      <OpportunitiesSection opportunities={state.opportunities} onOpenOpportunity={handleOpenOpportunity} />
      <OpportunityDrawer
        opportunity={selectedOpportunity}
        open={Boolean(selectedOpportunity)}
        onOpenChange={(open) => {
          if (!open) setSelectedOpportunityId(null);
        }}
        onSave={handleUpdateOpportunity}
        onAddNote={handleAddOpportunityNote}
        onCompleteTask={handleCompleteTask}
        tasks={state.tasks.filter((task) => task.opportunityId === selectedOpportunity?.id)}
        activities={state.activities
          .filter((activity) => activity.opportunityId === selectedOpportunity?.id)
          .slice(0, 8)}
      />
    </div>
  );
}
