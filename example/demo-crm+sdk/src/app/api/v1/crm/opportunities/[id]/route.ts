import { NextResponse } from "next/server";

import { opportunityPatchSchema } from "@/lib/crm-types";
import { IdempotencyConflictError, updateOpportunity } from "@/server/crm-store";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = opportunityPatchSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
    return NextResponse.json({ state: await updateOpportunity(id, body, idempotencyKey) });
  } catch (error) {
    if (!(error instanceof IdempotencyConflictError)) throw error;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 409 });
  }
}
