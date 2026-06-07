import z from "zod";

import type { crmOpportunitySchema } from "@/lib/crm-types";

export const opportunitySchema = z.object({
  id: z.string(),
  account: z.string(),
  stage: z.string(),
  priority: z.number(),
  health: z.string(),
  value: z.string(),
});

export const opportunitiesSchema = z.array(opportunitySchema);

export type OpportunityRow = z.infer<typeof crmOpportunitySchema>;
