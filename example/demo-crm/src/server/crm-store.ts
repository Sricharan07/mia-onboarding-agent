import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import opportunitySeedData from "@/app/(main)/dashboard/crm/_components/opportunities-table/data.json";

import {
  crmMetricsSchema,
  crmNoteSchema,
  crmOpportunitySchema,
  crmSnapshotSchema,
  type CrmActivity,
  type CrmMeeting,
  type CrmMetrics,
  type CrmNote,
  type CrmOpportunity,
  type CrmPipelineSeries,
  type CrmSnapshot,
  type CrmTask,
  type OpportunityOutcome,
  type OpportunityPatch,
} from "@/lib/crm-types";

type SeedRow = {
  id: string;
  account: string;
  stage: string;
  priority: number;
  health: string;
  value: string;
};

type CrmStateRecord = {
  updatedAt: string;
  opportunities: CrmOpportunity[];
  activities: CrmActivity[];
  tasks: CrmTask[];
  meetings: CrmMeeting[];
  pipelineSeries: CrmPipelineSeries;
  baselineMetrics: CrmMetrics;
  proposalGoal: number;
  discoveryCallsBooked: number;
};

const STORE_PATH = path.join(process.cwd(), "data", "crm-state.json");

const ownerPool = ["Maya Patel", "Jordan Lee", "Elena Brooks", "Noah Kim", "Ava Chen", "Samir Rao"];
const contactPool = [
  "Hannah Bell",
  "Marcus Green",
  "Priya Shah",
  "Daniel Wu",
  "Lena Ortiz",
  "Chris Morgan",
];
const nextStepPool = [
  "Send updated pricing and revisit in Friday's pipeline review.",
  "Confirm legal redlines and align on procurement timing.",
  "Schedule the follow-up discovery call.",
  "Share the proposal and ask for decision criteria.",
  "Prepare a tailored demo for the buying committee.",
];
const stageProbability: Record<string, number> = {
  "Proposal Sent": 68,
  Discovery: 32,
  Negotiation: 81,
  Qualified: 92,
};

let writeQueue: Promise<void> = Promise.resolve();

function asSeedRows(rows: SeedRow[]): SeedRow[] {
  return rows;
}

function parseMoney(value: string) {
  return Number(value.replace(/[$,]/g, ""));
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function nowIso() {
  return new Date().toISOString();
}

function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function monthsAgoIso(monthsAgo: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsAgo);
  return date.toISOString();
}

function toActivity(
  title: string,
  actor: string,
  type: CrmActivity["type"],
  opportunityId?: string,
  timestamp: string = nowIso(),
): CrmActivity {
  return {
    id: `activity_${crypto.randomUUID()}`,
    title,
    actor,
    timestamp,
    type,
    opportunityId,
  };
}

function createNotes(account: string, owner: string, index: number): CrmNote[] {
  if (index % 4 !== 0) {
    return [];
  }

  return [
    {
      id: `note_${crypto.randomUUID()}`,
      body: `Owner ${owner} left the latest update for ${account}. Customer is reviewing scope and timing.`,
      author: owner,
      createdAt: monthsAgoIso(index % 6),
    },
  ];
}

function buildOpportunity(row: SeedRow, index: number): CrmOpportunity {
  const owner = ownerPool[index % ownerPool.length];
  const contactName = contactPool[index % contactPool.length];
  const amount = parseMoney(row.value);
  const outcome: OpportunityOutcome = index % 8 === 0 ? "won" : index % 11 === 0 ? "lost" : "open";

  return crmOpportunitySchema.parse({
    id: row.id,
    account: row.account,
    contactName,
    owner,
    stage: row.stage,
    priority: row.priority,
    health: row.health,
    amount,
    value: formatMoney(amount),
    probability: stageProbability[row.stage] ?? 50,
    closeDate: daysFromNow(10 + (index % 20)),
    lastActivityAt: monthsAgoIso(index % 3),
    nextStep: nextStepPool[index % nextStepPool.length],
    outcome,
    notes: createNotes(row.account, owner, index),
  });
}

function buildPipelineSeries(opportunities: CrmOpportunity[]): CrmPipelineSeries {
  const qualified = opportunities.filter((opportunity) => opportunity.stage === "Qualified").length;
  const proposal = opportunities.filter((opportunity) => opportunity.stage === "Proposal Sent").length;
  const discovery = opportunities.filter((opportunity) => opportunity.stage === "Discovery").length;
  const negotiation = opportunities.filter((opportunity) => opportunity.stage === "Negotiation").length;

  return {
    last30Days: [discovery - 1, proposal, negotiation, qualified + 2].map((value) => Math.max(0, value)),
    lastQuarter: [proposal, negotiation, qualified].map((value) => Math.max(0, value)),
    last12Months: [30, 34, 31, 39, 35, 42, 40, 37, 44, 38, 41, qualified + proposal].map((value) => Math.max(0, value)),
  };
}

function buildTasks(opportunities: CrmOpportunity[]): CrmTask[] {
  const primary = opportunities.slice(0, 4);

  return [
    {
      id: "task_proposal_followup",
      title: `Follow up with ${primary[0]?.account ?? "priority account"}`,
      owner: primary[0]?.owner ?? "Maya Patel",
      dueDate: daysFromNow(1),
      status: "in_progress",
      linkedOpportunityId: primary[0]?.id,
      detail: "Confirm procurement timing and decision criteria.",
    },
    {
      id: "task_legal_review",
      title: `Send redline summary to ${primary[1]?.account ?? "legal review"}`,
      owner: primary[1]?.owner ?? "Jordan Lee",
      dueDate: daysFromNow(2),
      status: "not_started",
      linkedOpportunityId: primary[1]?.id,
      detail: "Bundle commercial terms and compliance notes.",
    },
    {
      id: "task_demo_refresh",
      title: `Refresh demo plan for ${primary[2]?.account ?? "late-stage opportunity"}`,
      owner: primary[2]?.owner ?? "Elena Brooks",
      dueDate: daysFromNow(3),
      status: "not_started",
      linkedOpportunityId: primary[2]?.id,
      detail: "Make sure the demo reflects the latest implementation scope.",
    },
    {
      id: "task_exec_update",
      title: "Prepare weekly pipeline summary",
      owner: "Maya Patel",
      dueDate: daysFromNow(1),
      status: "completed",
      detail: "Summarize movement across the qualified and negotiation stages.",
    },
  ];
}

function buildMeetings(opportunities: CrmOpportunity[]): CrmMeeting[] {
  const primary = opportunities.slice(0, 3);

  return [
    {
      id: "meeting_product_demo",
      title: "Product demo with Tim",
      account: "Weblabs Studio",
      time: "08:45 AM",
      date: "Today",
      status: "scheduled",
    },
    {
      id: "meeting_security_review",
      title: `Security review with ${primary[0]?.account ?? "Asteron Bioworks"}`,
      account: primary[0]?.account ?? "Asteron Bioworks",
      time: "10:00 AM",
      date: "Today",
      status: "scheduled",
    },
    {
      id: "meeting_pricing_workshop",
      title: `Pricing workshop with ${primary[1]?.account ?? "BlueHaven Systems"}`,
      account: primary[1]?.account ?? "BlueHaven Systems",
      time: "02:15 PM",
      date: "Tomorrow",
      status: "scheduled",
    },
  ];
}

function buildActivities(opportunities: CrmOpportunity[]): CrmActivity[] {
  return [
    toActivity(`Proposal sent to ${opportunities[0]?.account ?? "Asteron Bioworks"}`, "Maya Patel", "crm_change", opportunities[0]?.id, monthsAgoIso(0)),
    toActivity(`Discovery call booked for ${opportunities[1]?.account ?? "BlueHaven Systems"}`, "Jordan Lee", "crm_change", opportunities[1]?.id, monthsAgoIso(0)),
    toActivity(`Negotiation updated for ${opportunities[2]?.account ?? "Cinder Health"}`, "Elena Brooks", "crm_change", opportunities[2]?.id, monthsAgoIso(1)),
    toActivity(`Mia highlighted the ${opportunities[3]?.account ?? "next"} follow-up`, "Mia Assistant", "mia_action", opportunities[3]?.id, nowIso()),
  ];
}

function buildSeedState(): CrmStateRecord {
  const rows = asSeedRows(opportunitySeedData as SeedRow[]);
  const opportunities = rows.map((row, index) => buildOpportunity(row, index));
  const pipelineSeries = buildPipelineSeries(opportunities);
  const tasks = buildTasks(opportunities);
  const meetings = buildMeetings(opportunities);
  const activities = buildActivities(opportunities);
  const proposalGoal = 18;
  const discoveryCallsBooked = 184;

  return {
    updatedAt: nowIso(),
    opportunities,
    activities,
    tasks,
    meetings,
    pipelineSeries,
    baselineMetrics: computeMetrics(opportunities, proposalGoal, discoveryCallsBooked),
    proposalGoal,
    discoveryCallsBooked,
  };
}

function computeMetrics(opportunities: CrmOpportunity[], proposalGoal: number, discoveryCallsBooked: number): CrmMetrics {
  const total = opportunities.length || 1;
  const pipelineValue = opportunities.reduce((sum, opportunity) => sum + opportunity.amount, 0);
  const qualified = opportunities.filter((opportunity) => opportunity.stage === "Qualified").length;
  const openOpportunities = opportunities.filter((opportunity) => opportunity.outcome !== "lost").length;
  const won = opportunities.filter((opportunity) => opportunity.outcome === "won").length;
  const proposalSent = opportunities.filter((opportunity) => opportunity.stage === "Proposal Sent").length;
  const pipelineValuePrevious = Math.max(0, Math.round(pipelineValue * 0.9));
  const qualifiedRate = Math.round((qualified / total) * 1000) / 10;
  const qualifiedRatePrevious = Math.max(0, Math.round((qualifiedRate - 3.2) * 10) / 10);
  const openOpportunitiesPrevious = Math.max(0, openOpportunities - 5);
  const leadToDealRate = Math.round((won / total) * 1000) / 10;
  const leadToDealRatePrevious = Math.max(0, Math.round((leadToDealRate - 1.7) * 10) / 10);

  return crmMetricsSchema.parse({
    pipelineValue,
    pipelineValuePrevious,
    qualifiedRate,
    qualifiedRatePrevious,
    openOpportunities,
    openOpportunitiesPrevious,
    leadToDealRate,
    leadToDealRatePrevious,
    proposalSent,
    proposalGoal,
    discoveryCallsBooked,
  });
}

async function ensureStore(): Promise<CrmStateRecord> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = crmSnapshotSchema.parse(parsed);

    return {
      updatedAt: validated.updatedAt,
      opportunities: validated.opportunities,
      activities: validated.activities,
      tasks: validated.tasks,
      meetings: validated.meetings,
      pipelineSeries: validated.pipelineSeries,
      baselineMetrics: computeMetrics(validated.opportunities, validated.metrics.proposalGoal, validated.metrics.discoveryCallsBooked),
      proposalGoal: validated.metrics.proposalGoal,
      discoveryCallsBooked: validated.metrics.discoveryCallsBooked,
    };
  } catch {
    const seed = buildSeedState();
    await persistStore(seed);
    return seed;
  }
}

async function persistStore(state: CrmStateRecord): Promise<void> {
  const snapshot = buildSnapshot(state);
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STORE_PATH);
}

function buildSnapshot(state: CrmStateRecord): CrmSnapshot {
  const metrics = computeMetrics(state.opportunities, state.proposalGoal, state.discoveryCallsBooked);
  return crmSnapshotSchema.parse({
    updatedAt: state.updatedAt,
    metrics,
    pipelineSeries: state.pipelineSeries,
    opportunities: state.opportunities,
    activities: state.activities,
    tasks: state.tasks,
    meetings: state.meetings,
  });
}

function computePipelineDelta(stageBefore: string, stageAfter: string) {
  const wasQualified = stageBefore === "Qualified" ? 1 : 0;
  const isQualified = stageAfter === "Qualified" ? 1 : 0;
  return isQualified - wasQualified;
}

function updateSeries(state: CrmStateRecord, delta: number) {
  if (delta === 0) {
    return;
  }

  const bump = (series: number[]) => {
    if (!series.length) {
      return series;
    }
    const next = [...series];
    next[next.length - 1] = Math.max(0, next[next.length - 1] + delta);
    return next;
  };

  state.pipelineSeries = {
    last30Days: bump(state.pipelineSeries.last30Days),
    lastQuarter: bump(state.pipelineSeries.lastQuarter),
    last12Months: bump(state.pipelineSeries.last12Months),
  };
}

async function mutateStore<T>(mutator: (state: CrmStateRecord) => T | Promise<T>): Promise<T> {
  const execute = async () => {
    const state = await ensureStore();
    const result = await mutator(state);
    state.updatedAt = nowIso();
    await persistStore(state);
    return result;
  };

  const next = writeQueue.then(execute, execute);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function getCrmSnapshot(): Promise<CrmSnapshot> {
  const state = await ensureStore();
  return buildSnapshot(state);
}

export async function updateOpportunity(id: string, patch: OpportunityPatch): Promise<CrmSnapshot> {
  return mutateStore((state) => {
    const opportunity = state.opportunities.find((row) => row.id === id);

    if (!opportunity) {
      throw new Error("Opportunity not found.");
    }

    const stageBefore = opportunity.stage;

    if (patch.account !== undefined) opportunity.account = patch.account;
    if (patch.contactName !== undefined) opportunity.contactName = patch.contactName;
    if (patch.owner !== undefined) opportunity.owner = patch.owner;
    if (patch.stage !== undefined) opportunity.stage = patch.stage;
    if (patch.priority !== undefined) opportunity.priority = patch.priority;
    if (patch.health !== undefined) opportunity.health = patch.health;
    if (patch.amount !== undefined) {
      opportunity.amount = patch.amount;
      opportunity.value = formatMoney(patch.amount);
    }
    if (patch.probability !== undefined) opportunity.probability = patch.probability;
    if (patch.closeDate !== undefined) opportunity.closeDate = patch.closeDate;
    if (patch.nextStep !== undefined) opportunity.nextStep = patch.nextStep;
    if (patch.outcome !== undefined) opportunity.outcome = patch.outcome;

    opportunity.lastActivityAt = nowIso();
    const title = `Updated ${opportunity.account}`;
    state.activities.unshift(
      toActivity(title, "Mia Assistant", "crm_change", opportunity.id, opportunity.lastActivityAt),
    );
    updateSeries(state, computePipelineDelta(stageBefore, opportunity.stage));

    return buildSnapshot(state);
  });
}

export async function addOpportunityNote(id: string, body: string, author: string): Promise<CrmSnapshot> {
  return mutateStore((state) => {
    const opportunity = state.opportunities.find((row) => row.id === id);

    if (!opportunity) {
      throw new Error("Opportunity not found.");
    }

    const note = crmNoteSchema.parse({
      id: `note_${crypto.randomUUID()}`,
      body,
      author,
      createdAt: nowIso(),
    });

    opportunity.notes.unshift(note);
    opportunity.lastActivityAt = note.createdAt;
    state.activities.unshift(
      toActivity(`Added note to ${opportunity.account}`, author, "crm_change", opportunity.id, note.createdAt),
    );

    return buildSnapshot(state);
  });
}

export async function completeTask(id: string): Promise<CrmSnapshot> {
  return mutateStore((state) => {
    const task = state.tasks.find((row) => row.id === id);

    if (!task) {
      throw new Error("Task not found.");
    }

    task.status = "completed";
    state.activities.unshift(toActivity(`Completed task ${task.title}`, "Mia Assistant", "system_update", task.linkedOpportunityId));

    return buildSnapshot(state);
  });
}

export async function completeMeeting(id: string): Promise<CrmSnapshot> {
  return mutateStore((state) => {
    const meeting = state.meetings.find((row) => row.id === id);

    if (!meeting) {
      throw new Error("Meeting not found.");
    }

    const nextStatus = meeting.status === "completed" ? "scheduled" : "completed";
    meeting.status = nextStatus;
    state.activities.unshift(
      toActivity(
        `${nextStatus === "completed" ? "Completed" : "Reopened"} meeting ${meeting.title}`,
        "Mia Assistant",
        "system_update",
      ),
    );

    return buildSnapshot(state);
  });
}

export function formatCurrency(amount: number) {
  return formatMoney(amount);
}
