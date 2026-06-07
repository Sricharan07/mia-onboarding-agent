import { z } from "zod";

export const opportunityStageSchema = z.enum(["Proposal Sent", "Discovery", "Negotiation", "Qualified"]);
export type OpportunityStage = z.infer<typeof opportunityStageSchema>;

export const opportunityHealthSchema = z.enum(["On Track", "Needs Review", "At Risk", "On Hold"]);
export type OpportunityHealth = z.infer<typeof opportunityHealthSchema>;

export const opportunityOutcomeSchema = z.enum(["open", "won", "lost"]);
export type OpportunityOutcome = z.infer<typeof opportunityOutcomeSchema>;

export const crmNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
});
export type CrmNote = z.infer<typeof crmNoteSchema>;

export const crmActivitySchema = z.object({
  id: z.string(),
  title: z.string(),
  actor: z.string(),
  timestamp: z.string(),
  type: z.enum(["mia_action", "employee_action", "system_update", "crm_change"]),
  opportunityId: z.string().optional(),
});
export type CrmActivity = z.infer<typeof crmActivitySchema>;

export const crmTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
  dueDate: z.string(),
  status: z.enum(["not_started", "in_progress", "completed", "blocked"]),
  linkedOpportunityId: z.string().optional(),
  detail: z.string().optional(),
});
export type CrmTask = z.infer<typeof crmTaskSchema>;

export const crmMeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  account: z.string(),
  time: z.string(),
  date: z.string(),
  status: z.enum(["scheduled", "completed"]),
});
export type CrmMeeting = z.infer<typeof crmMeetingSchema>;

export const crmOpportunitySchema = z.object({
  id: z.string(),
  account: z.string(),
  contactName: z.string(),
  owner: z.string(),
  stage: opportunityStageSchema,
  priority: z.number().int().min(1).max(5),
  health: opportunityHealthSchema,
  amount: z.number().nonnegative(),
  value: z.string(),
  probability: z.number().int().min(0).max(100),
  closeDate: z.string(),
  lastActivityAt: z.string(),
  nextStep: z.string(),
  outcome: opportunityOutcomeSchema,
  notes: z.array(crmNoteSchema),
});
export type CrmOpportunity = z.infer<typeof crmOpportunitySchema>;

export const crmPipelineSeriesSchema = z.object({
  last30Days: z.array(z.number().nonnegative()),
  lastQuarter: z.array(z.number().nonnegative()),
  last12Months: z.array(z.number().nonnegative()),
});
export type CrmPipelineSeries = z.infer<typeof crmPipelineSeriesSchema>;

export const crmMetricsSchema = z.object({
  pipelineValue: z.number().nonnegative(),
  pipelineValuePrevious: z.number().nonnegative(),
  qualifiedRate: z.number().nonnegative(),
  qualifiedRatePrevious: z.number().nonnegative(),
  openOpportunities: z.number().nonnegative(),
  openOpportunitiesPrevious: z.number().nonnegative(),
  leadToDealRate: z.number().nonnegative(),
  leadToDealRatePrevious: z.number().nonnegative(),
  proposalSent: z.number().nonnegative(),
  proposalGoal: z.number().nonnegative(),
  discoveryCallsBooked: z.number().nonnegative(),
});
export type CrmMetrics = z.infer<typeof crmMetricsSchema>;

export const crmSnapshotSchema = z.object({
  updatedAt: z.string(),
  metrics: crmMetricsSchema,
  pipelineSeries: crmPipelineSeriesSchema,
  opportunities: z.array(crmOpportunitySchema),
  activities: z.array(crmActivitySchema),
  tasks: z.array(crmTaskSchema),
  meetings: z.array(crmMeetingSchema),
});
export type CrmSnapshot = z.infer<typeof crmSnapshotSchema>;

export const opportunityPatchSchema = z
  .object({
    account: z.string().min(1).optional(),
    contactName: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    stage: opportunityStageSchema.optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    health: opportunityHealthSchema.optional(),
    amount: z.coerce.number().nonnegative().optional(),
    probability: z.coerce.number().int().min(0).max(100).optional(),
    closeDate: z.string().min(1).optional(),
    nextStep: z.string().min(1).optional(),
    outcome: opportunityOutcomeSchema.optional(),
  })
  .strict();
export type OpportunityPatch = z.infer<typeof opportunityPatchSchema>;

export const crmNoteCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    author: z.string().trim().min(1).max(120).default("Mia Assistant"),
  })
  .strict();
export type CrmNoteCreate = z.infer<typeof crmNoteCreateSchema>;
