import { NextResponse } from "next/server";

import { completeTask } from "@/server/crm-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json({ state: await completeTask(id) });
}
