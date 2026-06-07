import { NextResponse } from "next/server";

import { opportunityPatchSchema } from "@/lib/crm-types";
import { updateOpportunity } from "@/server/crm-store";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = opportunityPatchSchema.parse(await request.json());
  return NextResponse.json({ state: await updateOpportunity(id, body) });
}
