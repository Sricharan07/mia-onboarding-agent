import { NextResponse } from "next/server";

import { crmSnapshotSchema, crmNoteCreateSchema } from "@/lib/crm-types";
import { addOpportunityNote } from "@/server/crm-store";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const payload = crmNoteCreateSchema.parse(body);
  const state = await addOpportunityNote(id, payload.body, payload.author);
  return NextResponse.json({ state: crmSnapshotSchema.parse(state) });
}
