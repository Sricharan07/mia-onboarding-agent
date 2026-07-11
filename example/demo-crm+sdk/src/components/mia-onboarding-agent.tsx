"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mia, defineMiaAction, type MiaEvent } from "@mia/onboarding-agent";
import type { CrmSnapshot, OpportunityPatch } from "@/lib/crm-types";

type CreateDraftInput = { account: string; contactName?: string; amount?: number };
type UpdateOpportunityInput = { id: string; patch: OpportunityPatch };

let instancePromise: Promise<Mia> | undefined;
let mountCount = 0;
let destroyTimer: number | undefined;

declare global {
  interface WindowEventMap {
    "mia:crm-state": CustomEvent<CrmSnapshot>;
    "mia:runtime-event": CustomEvent<MiaEvent>;
  }
}

export function MiaOnboardingAgent() {
  const router = useRouter();

  useEffect(() => {
    mountCount += 1;
    if (destroyTimer) window.clearTimeout(destroyTimer);
    const backendUrl = process.env.NEXT_PUBLIC_MIA_BACKEND_URL;
    if (!backendUrl) return () => { mountCount -= 1; };

    if (!instancePromise) instancePromise = initializeMia(backendUrl, (route) => router.push(route)).catch((error) => {
      instancePromise = undefined;
      window.dispatchEvent(new CustomEvent("mia:runtime-event", { detail: { type: "error", error: toError(error) } }));
      throw error;
    });
    void instancePromise.catch(() => undefined);

    return () => {
      mountCount -= 1;
      destroyTimer = window.setTimeout(() => {
        if (mountCount > 0) return;
        const current = instancePromise;
        instancePromise = undefined;
        void current?.then((instance) => instance.destroy()).catch(() => undefined);
      }, 0);
    };
  }, [router]);

  return null;
}

async function initializeMia(backendUrl: string, navigate: (route: string) => void): Promise<Mia> {
  return Mia.init({
    backendUrl,
    tokenProvider: async () => {
      const response = await fetch("/api/mia/runtime-token", { method: "POST", cache: "no-store" });
      const result = await response.json() as { token?: string; expiresAt?: string; error?: { message?: string } };
      if (!response.ok || !result.token) throw new Error(result.error?.message ?? "Unable to create a Mia runtime token.");
      return { token: result.token, expiresAt: result.expiresAt };
    },
    navigate,
    voice: {
      enabled: process.env.NEXT_PUBLIC_MIA_ENABLE_VOICE !== "false",
      voice: "Aoede",
      openMic: true,
      pushToTalk: true,
    },
    actions: [createDraftOpportunity, updateOpportunity],
    contextProviders: [{
      name: "crm_workspace",
      description: "Current CRM metrics, opportunities, meetings, and tasks with stable record IDs.",
      trusted: true,
      async getContext({ signal }) {
        const response = await fetch("/api/v1/crm/state", { signal, cache: "no-store" });
        if (!response.ok) throw new Error("CRM context is unavailable.");
        const { state } = await response.json() as { state: CrmSnapshot };
        return JSON.stringify({
          metrics: state.metrics,
          opportunities: state.opportunities.map(({ id, account, contactName, owner, stage, health, amount, probability, closeDate, nextStep, outcome, isDraft }) => ({ id, account, contactName, owner, stage, health, amount, probability, closeDate, nextStep, outcome, isDraft })),
          meetings: state.meetings,
          tasks: state.tasks,
          updatedAt: state.updatedAt,
        });
      },
    }],
    privacy: {
      redactedSelectors: ["[data-private]", "[data-mia-private]"],
      includePageText: true,
      includePageTitle: true,
      includeUrlQuery: false,
    },
    ui: { theme: "auto", cursorOffset: { x: 20, y: 20 }, bubbleMaxWidth: 320, bubbleLingerMs: 3_000 },
    onEvent: (event) => window.dispatchEvent(new CustomEvent("mia:runtime-event", { detail: event })),
  });
}

const createDraftOpportunity = defineMiaAction<CreateDraftInput>({
  name: "create_draft_opportunity",
  description: "Create a reversible CRM opportunity draft without sending or publishing anything.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      account: { type: "string", minLength: 1, maxLength: 120 },
      contactName: { type: "string", minLength: 1, maxLength: 120 },
      amount: { type: "number", minimum: 0, maximum: 100000000 },
    },
    required: ["account"],
  },
  risk: "reversible_write",
  async execute(input, { signal, idempotencyKey }) {
    const response = await fetch("/api/v1/crm/opportunities/drafts", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { status: "failed", message: "The CRM did not create the opportunity draft." };
    const result = await response.json() as { state: CrmSnapshot; draftId: string };
    publishState(result.state);
    return { status: "completed", message: `Created the ${input.account} opportunity as a draft.`, evidence: { draftId: result.draftId, state: "draft" } };
  },
});

const updateOpportunity = defineMiaAction<UpdateOpportunityInput>({
  name: "update_opportunity",
  description: "Update reversible fields on an existing CRM opportunity.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1 },
      patch: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          account: { type: "string", minLength: 1 },
          contactName: { type: "string", minLength: 1 },
          owner: { type: "string", minLength: 1 },
          stage: { enum: ["Proposal Sent", "Discovery", "Negotiation", "Qualified"] },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          health: { enum: ["On Track", "Needs Review", "At Risk", "On Hold"] },
          amount: { type: "number", minimum: 0 },
          probability: { type: "number", minimum: 0, maximum: 100 },
          closeDate: { type: "string", minLength: 1 },
          nextStep: { type: "string", minLength: 1 },
          outcome: { enum: ["open", "won", "lost"] },
        },
      },
    },
    required: ["id", "patch"],
  },
  risk: "reversible_write",
  async execute(input, { signal, idempotencyKey }) {
    const response = await fetch(`/api/v1/crm/opportunities/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(input.patch),
    });
    if (!response.ok) return { status: "failed", message: "The CRM did not update the opportunity." };
    const { state } = await response.json() as { state: CrmSnapshot };
    publishState(state);
    return { status: "completed", message: "The opportunity was updated.", evidence: { opportunityId: input.id, changedFields: Object.keys(input.patch) } };
  },
});

function publishState(state: CrmSnapshot): void {
  window.dispatchEvent(new CustomEvent("mia:crm-state", { detail: state }));
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
