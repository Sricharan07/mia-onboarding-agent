import { z } from "zod";

export const opportunityStageSchema = z.enum(["Proposal Sent", "Discovery", "Negotiation", "Qualified"]);
export const opportunityHealthSchema = z.enum(["On Track", "Needs Review", "At Risk", "On Hold"]);
export const opportunityOutcomeSchema = z.enum(["open", "won", "lost"]);
export const meetingStatusSchema = z.enum(["scheduled", "completed"]);
export const taskStatusSchema = z.enum(["not_started", "in_progress", "completed", "blocked"]);

export const crmNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
});

export const crmActivitySchema = z.object({
  id: z.string(),
  title: z.string(),
  actor: z.string(),
  timestamp: z.string(),
  type: z.enum(["mia_action", "employee_action", "system_update", "crm_change"]),
  opportunityId: z.string().optional(),
});

export const crmTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  account: z.string(),
  dueAt: z.string(),
  status: taskStatusSchema,
  opportunityId: z.string().optional(),
});

export const crmMeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  account: z.string(),
  opportunityId: z.string().optional(),
  time: z.string(),
  date: z.string(),
  status: meetingStatusSchema,
});

export const crmOpportunitySchema = z.object({
  id: z.string(),
  account: z.string(),
  contactName: z.string(),
  owner: z.string(),
  stage: opportunityStageSchema,
  priority: z.number(),
  health: opportunityHealthSchema,
  amount: z.number(),
  value: z.string(),
  probability: z.number().min(0).max(100),
  closeDate: z.string(),
  lastActivityAt: z.string(),
  nextStep: z.string(),
  outcome: opportunityOutcomeSchema,
  notes: z.array(crmNoteSchema),
});

export const crmPipelinePointSchema = z.object({
  date: z.string(),
  qualified: z.number(),
});

export const crmPipelineSeriesSchema = z.object({
  last30Days: z.array(crmPipelinePointSchema),
  lastQuarter: z.array(crmPipelinePointSchema),
  last12Months: z.array(crmPipelinePointSchema),
  discoveryCallsBooked: z.number(),
});

export const crmMetricsSchema = z.object({
  pipelineValue: z.number(),
  pipelineValueDisplay: z.string(),
  previousPipelineValueDisplay: z.string(),
  pipelineDeltaDisplay: z.string(),
  qualifiedLeadRate: z.number(),
  qualifiedLeadRateDisplay: z.string(),
  previousQualifiedLeadRateDisplay: z.string(),
  qualifiedLeadDeltaDisplay: z.string(),
  openOpportunities: z.number(),
  previousOpenOpportunities: z.number(),
  openOpportunitiesDeltaDisplay: z.string(),
  leadToDealRate: z.number(),
  leadToDealRateDisplay: z.string(),
  previousLeadToDealRateDisplay: z.string(),
  leadToDealDeltaDisplay: z.string(),
});

export const crmSnapshotSchema = z.object({
  opportunities: z.array(crmOpportunitySchema),
  meetings: z.array(crmMeetingSchema),
  tasks: z.array(crmTaskSchema),
  activities: z.array(crmActivitySchema),
  pipelineSeries: crmPipelineSeriesSchema,
  metrics: crmMetricsSchema,
  proposalSent: z.number(),
  proposalGoal: z.number(),
  updatedAt: z.string(),
});

export const opportunityPatchSchema = z.object({
  account: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  stage: opportunityStageSchema.optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  health: opportunityHealthSchema.optional(),
  amount: z.coerce.number().min(0).optional(),
  probability: z.coerce.number().min(0).max(100).optional(),
  closeDate: z.string().min(1).optional(),
  nextStep: z.string().min(1).optional(),
  outcome: opportunityOutcomeSchema.optional(),
});

export type OpportunityStage = z.infer<typeof opportunityStageSchema>;
export type OpportunityHealth = z.infer<typeof opportunityHealthSchema>;
export type OpportunityOutcome = z.infer<typeof opportunityOutcomeSchema>;
export type CrmNote = z.infer<typeof crmNoteSchema>;
export type CrmActivity = z.infer<typeof crmActivitySchema>;
export type CrmTask = z.infer<typeof crmTaskSchema>;
export type CrmMeeting = z.infer<typeof crmMeetingSchema>;
export type CrmOpportunity = z.infer<typeof crmOpportunitySchema>;
export type CrmPipelineSeries = z.infer<typeof crmPipelineSeriesSchema>;
export type CrmMetrics = z.infer<typeof crmMetricsSchema>;
export type CrmSnapshot = z.infer<typeof crmSnapshotSchema>;
export type OpportunityPatch = z.infer<typeof opportunityPatchSchema>;
