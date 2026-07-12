import { NextResponse } from "next/server";

import { draftOpportunityInputSchema } from "@/lib/crm-types";
import { createDraftOpportunity, IdempotencyConflictError } from "@/server/crm-store";

export async function POST(request: Request) {
  try {
    const input = draftOpportunityInputSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
    const result = await createDraftOpportunity(input, idempotencyKey);
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof IdempotencyConflictError)) throw error;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 });
  }
}
