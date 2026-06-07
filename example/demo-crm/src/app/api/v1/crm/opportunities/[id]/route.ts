import { NextResponse } from "next/server";

import { crmSnapshotSchema, opportunityPatchSchema } from "@/lib/crm-types";
import { updateOpportunity } from "@/server/crm-store";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const patch = opportunityPatchSchema.parse(body);
  const state = await updateOpportunity(id, patch);
  return NextResponse.json({ state: crmSnapshotSchema.parse(state) });
}
