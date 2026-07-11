import { NextResponse } from "next/server";
import { draftOpportunityInputSchema } from "@/lib/crm-types";
import { createDraftOpportunity } from "@/server/crm-store";

export async function POST(request: Request) {
  const input = draftOpportunityInputSchema.parse(await request.json());
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
  const result = await createDraftOpportunity(input, idempotencyKey);
  return NextResponse.json(result);
}
