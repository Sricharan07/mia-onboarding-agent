import { z } from "zod";

import seedRows from "@/app/(main)/dashboard/crm/_components/opportunities-table/data.json";
import {
  type CrmActivity,
  type CrmMeeting,
  type CrmOpportunity,
  type CrmPipelineSeries,
  type CrmSnapshot,
  type CrmTask,
  crmSnapshotSchema,
  type DraftOpportunityInput,
  type OpportunityHealth,
  type OpportunityPatch,
  type OpportunityStage,
} from "@/lib/crm-types";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type SeedRow = {
  id: string;
  account: string;
  stage: OpportunityStage;
  priority: number;
  health: OpportunityHealth;
  value: string;
};

const idempotencyRecordSchema = z.object({
  key: z.string().min(1).max(256),
  operation: z.string().min(1),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
});
const storedCrmStateSchema = crmSnapshotSchema.extend({
  _miaIdempotency: z.array(idempotencyRecordSchema).default([]),
});

type StoredCrmState = z.infer<typeof storedCrmStateSchema>;
type IdempotentMutation = { key: string; operation: string; payload: unknown };

const dataDir = process.env.MIA_DEMO_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const statePath = path.join(dataDir, "crm-state.json");

let writeQueue: Promise<void> = Promise.resolve();

const owners = ["Mia Chen", "Avery Stone", "Noah Kim", "Priya Shah", "Jordan Lee"];
const contacts = ["Tim", "Riley", "Morgan", "Casey", "Sam", "Alex", "Jamie", "Taylor"];

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor(readonly idempotencyKey: string) {
    super("This idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export async function getCrmSnapshot(): Promise<CrmSnapshot> {
  return toPublicSnapshot(await readStoredState());
}

export async function updateOpportunity(
  id: string,
  patch: OpportunityPatch,
  idempotencyKey?: string,
): Promise<CrmSnapshot> {
  return mutateState(
    (state) => {
      const opportunity = findOpportunity(state, id);
      const nextAmount = patch.amount ?? opportunity.amount;
      Object.assign(opportunity, {
        ...patch,
        amount: nextAmount,
        value: formatCurrency(nextAmount),
        lastActivityAt: "Just now",
      });
      state.activities.unshift(
        activity({
          title: `Updated ${opportunity.account} opportunity`,
          actor: "Sales Ops",
          type: "crm_change",
          opportunityId: opportunity.id,
        }),
      );
    },
    idempotencyKey ? { key: idempotencyKey, operation: `update_opportunity:${id}`, payload: patch } : undefined,
  );
}

export async function createDraftOpportunity(
  input: DraftOpportunityInput,
  idempotencyKey?: string,
): Promise<{ state: CrmSnapshot; draftId: string }> {
  const draftId = idempotencyKey
    ? `DRAFT-${stableId(idempotencyKey)}`
    : `DRAFT-${Date.now().toString(36).toUpperCase()}`;
  const state = await mutateState(
    (current) => {
      const existing = current.opportunities.find((opportunity) => opportunity.id === draftId);
      if (existing) {
        const sameRequest =
          existing.account === input.account &&
          existing.contactName === (input.contactName ?? "Unassigned") &&
          existing.amount === (input.amount ?? 0) &&
          existing.isDraft;
        if (!sameRequest && idempotencyKey) throw new IdempotencyConflictError(idempotencyKey);
        return;
      }
      const amount = input.amount ?? 0;
      current.opportunities.unshift({
        id: draftId,
        account: input.account,
        contactName: input.contactName ?? "Unassigned",
        owner: "Unassigned",
        stage: "Qualified",
        priority: 3,
        health: "Needs Review",
        amount,
        value: formatCurrency(amount),
        probability: 20,
        closeDate: futureDate(21),
        lastActivityAt: "Just now",
        nextStep: "Review and qualify this draft opportunity.",
        outcome: "open",
        isDraft: true,
        notes: [],
      });
      current.activities.unshift(
        activity({
          title: `Created draft opportunity for ${input.account}`,
          actor: "Mia Assistant",
          type: "mia_action",
          opportunityId: draftId,
        }),
      );
    },
    idempotencyKey ? { key: idempotencyKey, operation: "create_draft_opportunity", payload: input } : undefined,
  );
  return { state, draftId };
}

export async function addOpportunityNote(id: string, body: string, author = "Sales Ops"): Promise<CrmSnapshot> {
  return mutateState((state) => {
    const opportunity = findOpportunity(state, id);
    opportunity.notes.unshift({
      id: createId("note"),
      body,
      author,
      createdAt: "Just now",
    });
    opportunity.lastActivityAt = "Just now";
    state.activities.unshift(
      activity({
        title: `Added note to ${opportunity.account}`,
        actor: author,
        type: "employee_action",
        opportunityId: opportunity.id,
      }),
    );
  });
}

export async function completeTask(id: string): Promise<CrmSnapshot> {
  return mutateState((state) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.status = "completed";
    state.activities.unshift(
      activity({
        title: `Completed task: ${task.title}`,
        actor: "Mia Assistant",
        type: "mia_action",
        opportunityId: task.opportunityId,
      }),
    );
  });
}

export async function completeMeeting(id: string): Promise<CrmSnapshot> {
  return mutateState((state) => {
    const meeting = state.meetings.find((item) => item.id === id);
    if (!meeting) throw new Error(`Meeting not found: ${id}`);
    meeting.status = meeting.status === "completed" ? "scheduled" : "completed";
    state.activities.unshift(
      activity({
        title: `${meeting.status === "completed" ? "Completed" : "Reopened"} meeting: ${meeting.title}`,
        actor: "Sales Ops",
        type: "crm_change",
      }),
    );
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

async function mutateState(
  mutator: (state: CrmSnapshot) => void,
  idempotency?: IdempotentMutation,
): Promise<CrmSnapshot> {
  const operation = writeQueue.then(async () => {
    const state = await readStoredState();
    const requestHash = idempotency ? hashRequest(idempotency.operation, idempotency.payload) : undefined;
    const previous = idempotency ? state._miaIdempotency.find((record) => record.key === idempotency.key) : undefined;

    if (previous) {
      if (previous.operation !== idempotency?.operation || previous.requestHash !== requestHash) {
        throw new IdempotencyConflictError(previous.key);
      }
      return toPublicSnapshot(state);
    }

    mutator(state);
    const nextSnapshot = recomputeState({ ...toPublicSnapshot(state), updatedAt: new Date().toISOString() });
    const next: StoredCrmState = {
      ...nextSnapshot,
      _miaIdempotency:
        idempotency && requestHash
          ? [
              ...state._miaIdempotency,
              {
                key: idempotency.key,
                operation: idempotency.operation,
                requestHash,
                createdAt: new Date().toISOString(),
              },
            ]
          : state._miaIdempotency,
    };
    await writeStoredState(next);
    return toPublicSnapshot(next);
  });
  writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function readStoredState(): Promise<StoredCrmState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const state = storedCrmStateSchema.parse(JSON.parse(raw));
    return { ...migrateState(state), _miaIdempotency: state._miaIdempotency };
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    const initial: StoredCrmState = {
      ...recomputeState(createInitialState()),
      _miaIdempotency: [],
    };
    await writeStoredState(initial);
    return initial;
  }
}

async function writeStoredState(state: StoredCrmState): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(storedCrmStateSchema.parse(state), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, statePath);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function toPublicSnapshot(state: StoredCrmState): CrmSnapshot {
  return crmSnapshotSchema.parse(state);
}

function hashRequest(operation: string, payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, payload: canonicalJson(payload) }))
    .digest("hex");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createInitialState(): CrmSnapshot {
  const opportunities = (seedRows as SeedRow[]).map((row, index) => enrichOpportunity(row, index));
  return {
    opportunities,
    meetings: seedMeetings(),
    tasks: seedTasks(opportunities),
    activities: seedActivities(opportunities),
    pipelineSeries: buildPipelineSeries(opportunities),
    metrics: buildMetrics(opportunities),
    proposalSent: countProposalSent(opportunities),
    proposalGoal: 18,
    updatedAt: new Date().toISOString(),
  };
}

function enrichOpportunity(row: SeedRow, index: number): CrmOpportunity {
  const amount = parseCurrency(row.value);
  const owner = owners[index % owners.length];
  const contactName = contacts[index % contacts.length];
  return {
    ...row,
    owner,
    contactName,
    amount,
    value: formatCurrency(amount),
    probability: probabilityForStage(row.stage),
    closeDate: futureDate(index),
    lastActivityAt: index < 4 ? "Today" : `${(index % 9) + 1} days ago`,
    nextStep: nextStepForStage(row.stage, row.account),
    outcome: "open",
    isDraft: false,
    notes:
      index < 3
        ? [
            {
              id: createId("note"),
              body: `Initial qualification note for ${row.account}.`,
              author: owner,
              createdAt: `${index + 1} days ago`,
            },
          ]
        : [],
  };
}

function recomputeState(state: CrmSnapshot): CrmSnapshot {
  return {
    ...state,
    pipelineSeries: buildPipelineSeries(state.opportunities),
    metrics: buildMetrics(state.opportunities),
    proposalSent: countProposalSent(state.opportunities),
  };
}

function buildMetrics(opportunities: CrmOpportunity[]) {
  const open = opportunities.filter((item) => item.outcome === "open");
  const pipelineValue = open.reduce((sum, item) => sum + item.amount, 0);
  const qualifiedCount = open.filter((item) => item.stage === "Qualified").length;
  const proposalCount = countProposalSent(open);
  const qualifiedLeadRate = open.length ? Math.round((qualifiedCount / open.length) * 1000) / 10 : 0;
  const leadToDealRate = open.length ? Math.round(((proposalCount + qualifiedCount) / open.length) * 1000) / 10 : 0;
  const previousPipelineValue = Math.max(0, pipelineValue - 30_300);
  const previousOpen = Math.max(0, open.length - 7);

  return {
    pipelineValue,
    pipelineValueDisplay: formatCurrency(pipelineValue),
    previousPipelineValueDisplay: formatCurrency(previousPipelineValue),
    pipelineDeltaDisplay: "+12%",
    qualifiedLeadRate,
    qualifiedLeadRateDisplay: `${qualifiedLeadRate.toFixed(1)}%`,
    previousQualifiedLeadRateDisplay: `${Math.max(0, qualifiedLeadRate - 2.5).toFixed(1)}%`,
    qualifiedLeadDeltaDisplay: "-2.5%",
    openOpportunities: open.length,
    previousOpenOpportunities: previousOpen,
    openOpportunitiesDeltaDisplay: `+${open.length - previousOpen}`,
    leadToDealRate,
    leadToDealRateDisplay: `${leadToDealRate.toFixed(1)}%`,
    previousLeadToDealRateDisplay: `${Math.max(0, leadToDealRate - 1.6).toFixed(1)}%`,
    leadToDealDeltaDisplay: "+1.6%",
  };
}

function buildPipelineSeries(opportunities: CrmOpportunity[]): CrmPipelineSeries {
  const base = opportunities.filter((item) => item.stage === "Qualified").length;
  const values = [34, 38, 31, 47, 42, 51, 44, 40, 58, 46, 43, Math.max(base, 12)];
  return {
    last30Days: rollingSeries(values.slice(-4), 7),
    lastQuarter: rollingSeries(values.slice(-3), 30),
    last12Months: rollingSeries(values, 30),
    discoveryCallsBooked: Math.max(1, Math.round(opportunities.length * 1.55)),
  };
}

function rollingSeries(values: number[], dayStep: number) {
  return values.map((qualified, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (values.length - 1 - index) * dayStep);
    return { date: date.toISOString(), qualified };
  });
}

function seedMeetings(): CrmMeeting[] {
  return [
    {
      id: "meeting_product_demo",
      title: "Product demo with Tim",
      account: "Asteron Bioworks",
      opportunityId: "OP-1842",
      time: "08:45 AM",
      date: "Today",
      status: "scheduled",
    },
    {
      id: "meeting_security_review",
      title: "Security review with Asteron Bioworks",
      account: "Asteron Bioworks",
      opportunityId: "OP-1842",
      time: "10:00 AM",
      date: "Today",
      status: "scheduled",
    },
    {
      id: "meeting_pricing_workshop",
      title: "Pricing workshop with BlueHaven Systems",
      account: "BlueHaven Systems",
      opportunityId: "OP-1841",
      time: "02:15 PM",
      date: "Tomorrow",
      status: "scheduled",
    },
  ];
}

function migrateState(state: CrmSnapshot): CrmSnapshot {
  for (const meeting of state.meetings) {
    if (meeting.id === "meeting_product_demo") {
      meeting.account = "Asteron Bioworks";
      meeting.opportunityId = "OP-1842";
    }
    if (meeting.id === "meeting_security_review") {
      meeting.opportunityId = "OP-1842";
    }
    if (meeting.id === "meeting_pricing_workshop") {
      meeting.opportunityId = "OP-1841";
    }
  }
  return state;
}

function seedTasks(opportunities: CrmOpportunity[]): CrmTask[] {
  return opportunities.slice(0, 3).map((opportunity, index) => ({
    id: `task_${opportunity.id.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    title: `Follow up with ${opportunity.contactName}`,
    account: opportunity.account,
    dueAt: index === 0 ? "Today" : "Tomorrow",
    status: index === 0 ? "in_progress" : "not_started",
    opportunityId: opportunity.id,
  }));
}

function seedActivities(opportunities: CrmOpportunity[]): CrmActivity[] {
  return opportunities.slice(0, 5).map((opportunity, index) =>
    activity({
      title: `${opportunity.account} moved to ${opportunity.stage}`,
      actor: opportunity.owner,
      type: "crm_change",
      opportunityId: opportunity.id,
      timestamp: index === 0 ? "Just now" : `${index + 1} hours ago`,
    }),
  );
}

function activity(input: Omit<CrmActivity, "id" | "timestamp"> & { timestamp?: string }): CrmActivity {
  return {
    id: createId("activity"),
    timestamp: input.timestamp ?? "Just now",
    ...input,
  };
}

function findOpportunity(state: CrmSnapshot, id: string): CrmOpportunity {
  const opportunity = state.opportunities.find((item) => item.id === id);
  if (!opportunity) throw new Error(`Opportunity not found: ${id}`);
  return opportunity;
}

function probabilityForStage(stage: OpportunityStage): number {
  if (stage === "Qualified") return 35;
  if (stage === "Discovery") return 45;
  if (stage === "Proposal Sent") return 65;
  return 78;
}

function nextStepForStage(stage: OpportunityStage, account: string): string {
  if (stage === "Qualified") return `Schedule discovery call with ${account}.`;
  if (stage === "Discovery") return `Send recap and confirm buying criteria for ${account}.`;
  if (stage === "Proposal Sent") return `Follow up on proposal feedback from ${account}.`;
  return `Confirm legal and procurement timeline with ${account}.`;
}

function futureDate(index: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 7 + index);
  return date.toISOString().slice(0, 10);
}

function parseCurrency(value: string): number {
  return Number(value.replace(/[^0-9.-]/g, ""));
}

function countProposalSent(opportunities: CrmOpportunity[]): number {
  return opportunities.filter((item) => item.stage === "Proposal Sent").length;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}
