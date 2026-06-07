import { NextResponse } from "next/server";

import { z } from "zod";

import { addOpportunityNote } from "@/server/crm-store";

const noteInputSchema = z.object({
  body: z.string().min(1),
  author: z.string().min(1).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = noteInputSchema.parse(await request.json());
  return NextResponse.json({ state: await addOpportunityNote(id, body.body, body.author) });
}
